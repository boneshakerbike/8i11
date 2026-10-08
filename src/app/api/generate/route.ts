/**
 * API route: POST /api/generate
 * Generates a "looking back" story from posts on a given date using Claude
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { get_voice_pool, get_posts_on_date, get_post_url, save_story, save_story_audit } from '@/lib/db';
import { build_story_audit } from '@/lib/story_audit';
import { pick_story_image_url } from '@/lib/story_image';
import { MODELS } from '@/lib/models';
import { first_text } from '@/lib/anthropic_response';
import {
  build_exemplar_block,
  CLICHE_PATTERNS,
  pick_retrospective_angles,
} from '@/lib/substack_titles';
import { build_voice_block, make_seeded_rand, sample_voice_exemplars } from '@/lib/voice_corpus';
import { build_canon_block, build_endorsed_block } from '@/lib/canon';

function stripCodeFences(text: string): string {
  let cleaned = text.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }

  return cleaned.trim();
}

function extractTagContent(response: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i');
  const match = response.match(pattern);

  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

function blurbFromStory(story_html: string): string {
  const text = story_html
    .replace(/<h2[^>]*>.*?<\/h2>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  return sentences.slice(0, 2).join(' ').trim().substring(0, 300);
}

export async function POST(request: NextRequest) {
  const api_key = process.env.ANTHROPIC_API_KEY;

  if (!api_key) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { month, day } = body;
    // Comparison mode: no database writes, and a seeded sampler so an A/B run
    // shows both arms identical grounding.
    const preview = body.preview === true;
    const rand = typeof body.seed === 'number' ? make_seeded_rand(body.seed) : Math.random;

    if (!month || !day) {
      return NextResponse.json(
        { error: 'month and day are required' },
        { status: 400 }
      );
    }

    const posts = await get_posts_on_date(month, day);

    if (posts.length === 0) {
      return NextResponse.json(
        { error: 'No posts found for this date' },
        { status: 404 }
      );
    }

    // Pick a renderable image from the posts. Skips video sources and
    // tracking pixels, then chooses randomly across remaining candidates so
    // the same date doesn't always reuse the very first <img> in the feed.
    const image_url = pick_story_image_url(posts);

    // Format posts for the prompt
    const formatted_posts = posts.map(post => {
      // Strip HTML tags from content
      let plain_text = '';
      if (post.content_html) {
        plain_text = post.content_html
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }

      return `## ${post.year}: ${post.title}
URL: ${get_post_url(post.post_id)}
${post.years_ago === 0 ? '(this year)' : post.years_ago === 1 ? '(1 year ago)' : `(${post.years_ago} years ago)`}

${plain_text || post.blurb || '(no content available)'}
`;
    }).join('\n---\n\n');

    // Format the date for display
    const date_display = new Date(2000, month - 1, day).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric'
    });

    // Prompt Library: "Story Generation" — update library if this changes
    const system_prompt = `You are writing an "On This Day" reflection post for my Substack newsletter.

BASE VOICE (from story generation style):
- Tone: Balance humor with insight (target 3 on Funny vs. Serious)
- Style: Conversational, diary-like, straightforward (target 4 on Formal vs. Casual)
- Respect: Courteous with light irreverence (target 2 on Respectful vs. Irreverent)
- Energy: Clear enthusiasm for outdoor life, direct delivery (target 2 on Enthusiastic vs. Matter of Fact)
- Replace em dashes with ellipses or commas
- No emojis
- Intentional sentence rhythm variation

ADAPTIVE VOICE REFINEMENT:
First, analyze the provided posts for recurring themes, word choices, and tonal patterns. Subtly adjust the base voice to echo these detected nuances while maintaining the core style parameters above.

CONTENT STRUCTURE:
1. Title: 2 to 7 words. It must come out of the SPECIFIC posts below, not out of the date.
   Use the real nouns from those posts: the places, the gear, the animals, the thing that
   went wrong, the habit that keeps repeating. Do not put the month or the day number in
   the title, and do not refer to the date at all... the page already prints it directly
   under the title. No colons. No rhyming. No alliteration for its own sake.

${build_exemplar_block()}

   These title shapes are worn out from overuse everywhere. Write something that is not
   one of them:
${CLICHE_PATTERNS.map(p => `   - ${p.name}`).join('\n')}
2. Weave themes from posts showing evolution/consistency
3. IMPORTANT: Include a link to EVERY post provided - no exceptions. Each URL must appear EXACTLY ONCE (no duplicates)
4. Reflective ending with appreciative insight
5. 150-300 words (scale with post count: ~30 words per post minimum)

FORMAT:
- Return exactly this structure with no markdown fences:
<response>
<story><h2>Title</h2><p>...</p></story>
<blurb>Two to three plain-text sentences that summarize the story for sharing.</blurb>
</response>
- story must be HTML with <h2> title, <p> paragraphs, <a href> links
- blurb must be plain text only, no HTML, no markdown`;

    // Per-request grounding goes in the user message, never the system block:
    // the system prompt carries cache_control, and a freshly sampled block there
    // would invalidate the cache on every call.
    let voice_block = '';
    try {
      voice_block = build_voice_block(sample_voice_exemplars(await get_voice_pool(), 16, rand));
    } catch (e) {
      console.error('Voice pool lookup failed:', e instanceof Error ? e.message : String(e));
    }

    const angles = pick_retrospective_angles(2, rand);

    const grounding = [
      build_endorsed_block(),
      voice_block,
      build_canon_block(),
      `**Angles to try for this title.** The title spans every year below, so reach for the pattern across them:\n${angles.map(a => `- ${a}`).join('\n')}`,
    ].filter(Boolean).join('\n\n');

    // User message (dynamic) - changes with each request
    const user_message = `Write a reflection for ${date_display}. Here are my posts from this date:

${formatted_posts}

${grounding}`;

    const client = new Anthropic({ apiKey: api_key });

    const message = await client.messages.create({
      model: MODELS.STORY_GENERATION,
      max_tokens: 11000,
      thinking: { type: 'disabled' },
      system: [
        {
          type: 'text',
          text: system_prompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        { role: 'user', content: user_message }
      ]
    });

    const raw_text = first_text(message);
    if (!raw_text) {
      throw new Error('Unexpected response type');
    }

    const response_text = stripCodeFences(raw_text);
    const story = extractTagContent(response_text, 'story');

    if (!story) {
      throw new Error('Missing <story> in model response');
    }

    const raw_blurb = extractTagContent(response_text, 'blurb');
    const blurb = (raw_blurb || blurbFromStory(story))
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const date_key = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const audit = build_story_audit(posts.map(post => ({
      post_id: post.post_id,
      title: post.title,
      url: get_post_url(post.post_id),
      content_html: post.content_html
    })));

    // In preview mode nothing is written — not the story, and not the audit,
    // which would otherwise describe a story that was never persisted.
    let story_id: string | null = null;
    if (!preview) {
      story_id = await save_story(date_key, date_display, story, blurb, posts.length, image_url);
      await save_story_audit(story_id, audit);
    }

    return NextResponse.json({
      success: true,
      story,
      blurb,
      story_id,
      audit,
      posts_used: posts.length,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: (message.usage as unknown as Record<string, number>).cache_creation_input_tokens || 0,
        cache_read_input_tokens: (message.usage as unknown as Record<string, number>).cache_read_input_tokens || 0
      }
    });

  } catch (error) {
    console.error('Generate error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to generate story';
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

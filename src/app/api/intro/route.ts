/**
 * API route: POST /api/intro
 * Generates a short intro paragraph for the copy feature using Sonnet (see MODELS.INTRO)
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/models';
import { first_text } from '@/lib/anthropic_response';

// Reads the archive and makes a model call.
export const maxDuration = 300;

interface PostSummary {
  year: number;
  title: string;
  blurb: string | null;
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
    const { date_display, posts } = await request.json() as {
      date_display: string;
      posts: PostSummary[];
    };

    if (!date_display || !posts || posts.length === 0) {
      return NextResponse.json(
        { error: 'date_display and posts are required' },
        { status: 400 }
      );
    }

    // Calculate year span
    const years = posts.map(p => p.year).sort((a, b) => a - b);
    const earliest_year = years[0];
    const latest_year = years[years.length - 1];
    const year_span = latest_year - earliest_year;

    // Build minimal context for the AI
    const post_summaries = posts.map(p =>
      `${p.year}: "${p.title}"${p.blurb ? ` - ${p.blurb}` : ''}`
    ).join('\n');

    // Prompt Library: "Copy Intro" — update library if this changes
    const prompt = `Write a heading and a short intro for an "On This Day" roundup of my past posts.

Date: ${date_display}
Posts: ${posts.length} posts, ${year_span > 0 ? `${earliest_year}-${latest_year}` : earliest_year}
Topics:
${post_summaries}

**The heading** (2 to 6 words):
- This heading sits above the list of posts, so it should register the span of years, not the single calendar date. "Nine ${date_display}s" or "Seven Years of This Week" is the idea.
- Do not output the literal words "On This Day". That is what it used to say every single time.
- It may use the count or the year range above as a fact. It must not read like a section label.

**The intro** (two sentences, 30-40 words total):
- Do not open by counting the posts or naming the date... the heading already covers both.
- Open on something specific drawn from the posts above.
- Second sentence: a wry observation about what they have in common. Ellipses to list two or three things if useful.
- Tone: understated, gently self-aware. No purple prose. No "anthology" or "tapestry" or fancy metaphors.

Output exactly this, with no other text:
Heading: [the heading]
Intro: [the two sentences]`;

    const client = new Anthropic({ apiKey: api_key });

    const message = await client.messages.create({
      model: MODELS.INTRO,
      max_tokens: 1000,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const raw_text = first_text(message);
    if (!raw_text) {
      throw new Error('Unexpected response type');
    }

    const heading_match = raw_text.match(/^\s*Heading\s*:\s*(.+)$/im);
    const intro_match = raw_text.match(/^\s*Intro\s*:\s*([\s\S]+)$/im);

    // Fall back to the whole response as the intro if the model skipped the
    // labels, so a format slip degrades rather than failing the copy action.
    const heading = heading_match ? heading_match[1].trim() : '';
    const intro = (intro_match ? intro_match[1] : raw_text).trim();

    return NextResponse.json({
      success: true,
      heading,
      intro,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    console.error('Intro generation error:', error);
    const is_prod = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { error: is_prod ? 'Failed to generate intro' : (error instanceof Error ? error.message : 'Failed to generate intro') },
      { status: 500 }
    );
  }
}

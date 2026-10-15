/**
 * Markdown Converter Tool
 * Convert rich text to Markdown and vice versa
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import NavTabs from '@/components/nav_tabs';

export default function MarkdownConverterPage() {
  const [markdown_content, set_markdown_content] = useState('');
  const [is_updating_from_rich, set_is_updating_from_rich] = useState(false);
  const [is_updating_from_markdown, set_is_updating_from_markdown] = useState(false);
  const [copy_status, set_copy_status] = useState<string | null>(null);
  const rich_editor_ref = useRef<HTMLDivElement>(null);
  const markdown_textarea_ref = useRef<HTMLTextAreaElement>(null);
  const markdown_timeout_ref = useRef<NodeJS.Timeout | null>(null);
  const rich_timeout_ref = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (rich_timeout_ref.current) clearTimeout(rich_timeout_ref.current);
      if (markdown_timeout_ref.current) clearTimeout(markdown_timeout_ref.current);
    };
  }, []);

  useEffect(() => {
    const ta = markdown_textarea_ref.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [markdown_content]);

  // HTML to Markdown converter
  const html_to_markdown = (html: string): string => {
    if (!html.trim()) return '';

    const temp_div = document.createElement('div');
    temp_div.innerHTML = html;

    // Move leading/trailing whitespace outside inline markers so pastes like
    // "<strong>Supported </strong>child" become "**Supported** child"
    const wrap_inline = (marker: string, content: string): string => {
      const match = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const body = match ? match[2] : content;
      if (!body) return '';
      return `${match ? match[1] : ''}${marker}${body}${marker}${match ? match[3] : ''}`;
    };

    const process_node = (node: Node, depth: number = 0): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const tag_name = element.tagName.toLowerCase();
        const indent = '  '.repeat(depth);
        const children = Array.from(node.childNodes).map(child => process_node(child, depth)).join('');

        // Confluence paste handling: icons, macros, smart links, panels, tasks
        if (element.getAttribute('aria-hidden') === 'true') return '';
        if (element.hasAttribute('data-fabric-macro') || element.hasAttribute('data-macro-name')) {
          const macro_name = `${element.getAttribute('data-macro-name') || ''} ${element.getAttribute('data-vc') || ''}`;
          if (macro_name.includes('toc')) return '\n\n> *Auto-generated table of contents (Confluence TOC macro)*\n\n';
          if (macro_name.includes('children')) return '\n\n> *Auto-generated list of child pages (Confluence Children Display macro)*\n\n';
        }
        if (element.getAttribute('data-inline-card') === 'true') {
          const card_url = element.getAttribute('data-card-url');
          if (card_url) return `[${card_url}](${card_url})`;
        }
        if (element.hasAttribute('data-task-local-id')) {
          const checked = element.querySelector('input[type="checkbox"]')?.hasAttribute('checked');
          const task_text = children.trim().replace(/\n+/g, ' ');
          return task_text ? `- [${checked ? 'x' : ' '}] ${task_text}\n\n` : '';
        }
        if (element.getAttribute('data-node-type') === 'status') {
          return children.trim() ? `**${children.trim()}**` : '';
        }
        if (element.classList.contains('ak-editor-panel')) {
          const panel_type = element.getAttribute('data-panel-type') || '';
          const label = panel_type ? `**${panel_type.charAt(0).toUpperCase()}${panel_type.slice(1)}:** ` : '';
          const quoted = children.trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n> ');
          return quoted ? `\n\n> ${label}${quoted}\n\n` : '';
        }

        switch (tag_name) {
          case 'h1': return `\n\n# ${children.trim()}\n\n`;
          case 'h2': return `\n\n## ${children.trim()}\n\n`;
          case 'h3': return `\n\n### ${children.trim()}\n\n`;
          case 'h4': return `\n\n#### ${children.trim()}\n\n`;
          case 'h5': return `\n\n##### ${children.trim()}\n\n`;
          case 'h6': return `\n\n###### ${children.trim()}\n\n`;
          case 'p': return children.trim() ? `${children.trim()}\n\n` : '';
          case 'strong':
          case 'b': return wrap_inline('**', children);
          case 'em':
          case 'i': return wrap_inline('*', children);
          case 'u': return `<u>${children}</u>`;
          case 'a': {
            const href = element.getAttribute('href');
            if (!href || !children.trim()) return children.trim() ? children : '';
            // Confluence draft/resume links are navigation noise, keep the text only
            if (href.includes('resumedraft.action')) return children;
            return `[${children}](${href})`;
          }
          case 'button':
            // Confluence wraps @mentions in a profile-card button, keep the name
            return element.querySelector('[data-mention-id]') ? children : '';
          case 'svg':
          case 'input': return '';
          case 'br': return '\n';
          case 'hr': return '\n---\n\n';
          case 'ul':
            const items = Array.from(element.children)
              .filter(child => child.tagName.toLowerCase() === 'li')
              .map(li => {
                const li_children = Array.from(li.childNodes)
                  .map(child => {
                    if ((child as HTMLElement).tagName?.toLowerCase() === 'ul') {
                      return '\n' + process_node(child, depth + 1);
                    }
                    return process_node(child, depth);
                  })
                  .join('')
                  .trim();
                return `${indent}- ${li_children}`;
              })
              .filter(item => item.length > indent.length + 2);
            return items.length > 0 ? items.join('\n') + '\n\n' : '';
          case 'ol':
            const numbered_items = Array.from(element.children)
              .filter(child => child.tagName.toLowerCase() === 'li')
              .map((li, index) => {
                const li_children = Array.from(li.childNodes)
                  .map(child => {
                    if ((child as HTMLElement).tagName?.toLowerCase() === 'ol') {
                      return '\n' + process_node(child, depth + 1);
                    }
                    return process_node(child, depth);
                  })
                  .join('')
                  .trim();
                return `${indent}${index + 1}. ${li_children}`;
              })
              .filter(item => item.length > indent.length + 3);
            return numbered_items.length > 0 ? numbered_items.join('\n') + '\n\n' : '';
          case 'li': return '';
          case 'table': {
            const rows = Array.from(element.querySelectorAll('tr'));
            if (rows.length === 0) return '';
            const result_rows: string[] = [];
            rows.forEach((row, idx) => {
              const cells = Array.from(row.querySelectorAll('th, td'))
                .map(cell => (cell.textContent?.trim() || '').replace(/\|/g, '\\|'));
              result_rows.push(`| ${cells.join(' | ')} |`);
              if (idx === 0) result_rows.push(`| ${cells.map(() => '---').join(' | ')} |`);
            });
            return result_rows.join('\n') + '\n\n';
          }
          case 'thead':
          case 'tbody':
          case 'tfoot':
          case 'tr':
          case 'th':
          case 'td': return children;
          case 'script':
          case 'style':
          case 'head':
          case 'meta':
          case 'link': return '';
          case 'blockquote': return `> ${children.trim()}\n\n`;
          case 'code': return wrap_inline('`', children);
          case 'pre': return `\`\`\`\n${children.trim()}\n\`\`\`\n\n`;
          case 'img': {
            const alt = element.getAttribute('alt') || '';
            const src = element.getAttribute('src') || '';
            return src ? `![${alt}](${src})\n\n` : '';
          }
          case 'div':
          case 'section':
          case 'article':
          case 'main':
          case 'header':
          case 'footer':
          case 'nav': return children.trim() ? `${children.trim()}\n\n` : '';
          default: return children;
        }
      }

      return '';
    };

    let markdown = process_node(temp_div);
    markdown = markdown.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    return markdown;
  };

  // Markdown to HTML converter
  const markdown_to_html = (markdown: string): string => {
    if (!markdown.trim()) return '';

    const lines = markdown.split('\n');
    let html = '';
    let in_list = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed_line = line.trim();

      if (!trimmed_line) {
        if (in_list) {
          html += '</ul>';
          in_list = false;
        }
        html += '<br>';
        continue;
      }

      // Headers
      if (trimmed_line.startsWith('#')) {
        if (in_list) { html += '</ul>'; in_list = false; }
        const match = trimmed_line.match(/^#+/);
        const level = match ? match[0].length : 1;
        const text = trimmed_line.replace(/^#+\s*/, '');
        html += `<h${level}>${text}</h${level}>`;
        continue;
      }

      // Horizontal rules
      if (trimmed_line === '---') {
        if (in_list) { html += '</ul>'; in_list = false; }
        html += '<hr>';
        continue;
      }

      // Bullet lists
      if (trimmed_line.startsWith('- ')) {
        if (!in_list) { html += '<ul>'; in_list = true; }
        const text = trimmed_line.substring(2);
        html += `<li>${text}</li>`;
        continue;
      }

      // Regular text
      if (in_list) { html += '</ul>'; in_list = false; }

      let processed_line = trimmed_line;
      processed_line = processed_line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      processed_line = processed_line.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      processed_line = processed_line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

      html += `<p>${processed_line}</p>`;
    }

    if (in_list) html += '</ul>';
    return html;
  };

  // Handle rich text editor changes
  const handle_rich_text_change = () => {
    if (rich_editor_ref.current && !is_updating_from_markdown) {
      const html = rich_editor_ref.current.innerHTML;

      if (rich_timeout_ref.current) clearTimeout(rich_timeout_ref.current);

      rich_timeout_ref.current = setTimeout(() => {
        set_is_updating_from_rich(true);
        const markdown = html_to_markdown(html);
        set_markdown_content(markdown);
        set_is_updating_from_rich(false);
      }, 300);
    }
  };

  // Apply a new markdown value and re-sync the rich editor preview.
  const apply_markdown = (markdown: string) => {
    set_markdown_content(markdown);

    if (!is_updating_from_rich) {
      if (markdown_timeout_ref.current) clearTimeout(markdown_timeout_ref.current);

      markdown_timeout_ref.current = setTimeout(() => {
        try {
          set_is_updating_from_markdown(true);
          if (rich_editor_ref.current) {
            const html = markdown_to_html(markdown);
            rich_editor_ref.current.innerHTML = html;
          }
        } finally {
          set_is_updating_from_markdown(false);
        }
      }, 300);
    }
  };

  const handle_markdown_change = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    apply_markdown(e.target.value);
  };

  // Apply formatting
  const apply_format = (command: string, value: string | null = null) => {
    document.execCommand(command, false, value || undefined);
    handle_rich_text_change();
    rich_editor_ref.current?.focus();
  };

  // Clear functions
  const clear_rich_text = () => {
    if (rich_editor_ref.current) {
      rich_editor_ref.current.innerHTML = '';
      set_markdown_content('');
    }
  };

  const clear_markdown = () => {
    set_markdown_content('');
    if (rich_editor_ref.current) {
      rich_editor_ref.current.innerHTML = '';
    }
  };

  // Copy markdown
  const copy_markdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown_content);
      set_copy_status('Copied!');
      setTimeout(() => set_copy_status(null), 2000);
    } catch {
      set_copy_status('Copy failed');
      setTimeout(() => set_copy_status(null), 2000);
    }
  };

  // Copy the raw HTML behind the rich text editor (e.g. what a Confluence paste really contains)
  const copy_html = async () => {
    try {
      await navigator.clipboard.writeText(rich_editor_ref.current?.innerHTML || '');
      set_copy_status('HTML copied!');
      setTimeout(() => set_copy_status(null), 2000);
    } catch {
      set_copy_status('Copy failed');
      setTimeout(() => set_copy_status(null), 2000);
    }
  };

  // Insert link
  const insert_link = () => {
    const url = prompt('Enter URL:');
    if (url) apply_format('createLink', url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] text-gray-200 p-5">
      <div className="max-w-6xl mx-auto">
        <NavTabs />

        <h1 className="text-center text-3xl font-light text-cyan-400 mb-2">
          Markdown Converter
        </h1>
        <p className="text-center text-gray-400 mb-6">
          Real-time conversion between rich text and Markdown
        </p>

        {/* Copy status toast */}
        {copy_status && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
            {copy_status}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Rich Text Editor */}
          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden min-w-0">
            <div className="bg-white/5 px-4 py-2 border-b border-white/10">
              <h3 className="font-medium text-gray-300">Rich Text Editor</h3>
            </div>

            {/* Toolbar */}
            <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex flex-wrap gap-2">
              <button
                onClick={() => apply_format('bold')}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm font-bold transition-all"
                title="Bold"
              >
                B
              </button>
              <button
                onClick={() => apply_format('italic')}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm italic transition-all"
                title="Italic"
              >
                I
              </button>
              <button
                onClick={() => apply_format('underline')}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm underline transition-all"
                title="Underline"
              >
                U
              </button>
              <button
                onClick={() => apply_format('insertOrderedList')}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm transition-all"
                title="Numbered List"
              >
                1.
              </button>
              <button
                onClick={() => apply_format('insertUnorderedList')}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm transition-all"
                title="Bullet List"
              >
                •
              </button>
              <button
                onClick={insert_link}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm transition-all"
                title="Insert Link"
              >
                Link
              </button>
              <button
                onClick={copy_html}
                className="px-3 py-1 bg-white/10 hover:bg-cyan-400/20 rounded border border-white/20 text-sm transition-all"
                title="Copy the raw HTML of the pasted content"
              >
                Copy HTML
              </button>
              <button
                onClick={clear_rich_text}
                className="px-3 py-1 bg-white/10 hover:bg-red-400/20 rounded border border-white/20 text-sm transition-all"
                title="Clear"
              >
                Clear
              </button>
            </div>

            {/* Editor */}
            <div
              ref={rich_editor_ref}
              contentEditable
              className="p-4 min-h-[400px] focus:outline-none prose prose-invert prose-sm max-w-none bg-white/5 overflow-x-auto break-words [&_img]:max-w-full [&_img]:h-auto"
              onInput={handle_rich_text_change}
              style={{ minHeight: '400px', overflowWrap: 'break-word', wordBreak: 'break-word' }}
            />
          </div>

          {/* Markdown Output */}
          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden min-w-0">
            <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center">
              <h3 className="font-medium text-gray-300">Markdown</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={copy_markdown}
                  className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-cyan-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  title="Copy"
                >
                  Copy
                </button>
                <button
                  onClick={clear_markdown}
                  className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-red-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  title="Clear"
                >
                  Clear
                </button>
              </div>
            </div>

            <textarea
              ref={markdown_textarea_ref}
              value={markdown_content}
              onChange={handle_markdown_change}
              className="w-full p-4 font-mono text-sm focus:outline-none bg-transparent text-gray-200 overflow-hidden"
              style={{ minHeight: '456px' }}
              placeholder="Markdown output will appear here..."
            />
          </div>
        </div>

        <p className="mt-6 text-sm text-gray-400 text-center">
          Supports headers, paragraphs, bold, italic, links, and lists.
        </p>
      </div>
    </div>
  );
}

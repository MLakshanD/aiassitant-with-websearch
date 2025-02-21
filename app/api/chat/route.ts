export const runtime = 'edge';
import { tavily } from '@tavily/core';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Helper function to handle Unicode characters
function sanitizeContent(content: string): string {
  if (!content) return '';

  // Normalize the string
  try {
    content = content.normalize('NFKD');
  } catch (e) {
    console.warn('Failed to normalize content:', e);
  }

  // Replace problematic characters with ASCII equivalents
  const replacements = {
    '\u201C': '"', // left double quote
    '\u201D': '"', // right double quote
    '\u2018': "'", // left single quote
    '\u2019': "'", // right single quote
    '\u2014': '-', // em dash
    '\u2013': '-', // en dash
    '\u2026': '...' // ellipsis
  };

  // Replace known problematic characters
  for (const [from, to] of Object.entries(replacements)) {
    content = content.replaceAll(from, to);
  }

  // Remove any remaining non-ASCII characters
  return content.replace(/[^\x00-\x7F]/g, '');
}

// Helper function to fetch with retries and exponential backoff
async function fetchWithRetries(url: string, options: RequestInit, retries = 3, delay = 1000): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response;
  } catch (error) {
    if (retries === 0) throw error;
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetries(url, options, retries - 1, delay * 2);
  }
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  try {
    const apiKey = process.env.TOGETHER_API_KEY;
    const tavilyKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      throw new Error('TOGETHER_API_KEY is not configured');
    }
    if (!tavilyKey) {
      throw new Error('TAVILY_API_KEY is not configured');
    }

    // Validate request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      throw new Error('Failed to parse request body as JSON');
    }

    if (!body || typeof body !== 'object') {
      throw new Error('Invalid request body: expected an object');
    }

    if (!Array.isArray(body.messages)) {
      throw new Error('Invalid request body: messages must be an array');
    }

    const rawMessages = body.messages;

    // Validate each message
    const messages: ChatMessage[] = rawMessages.map((msg: any, index: number) => {
      if (!msg || typeof msg !== 'object') {
        throw new Error(`Invalid message at index ${index}: expected an object`);
      }
      if (typeof msg.role !== 'string' || !msg.role) {
        throw new Error(`Invalid message at index ${index}: role must be a non-empty string`);
      }
      if (typeof msg.content !== 'string' || !msg.content) {
        throw new Error(`Invalid message at index ${index}: content must be a non-empty string`);
      }
      if (!['user', 'assistant', 'system'].includes(msg.role)) {
        throw new Error(`Invalid message at index ${index}: role must be 'user', 'assistant', or 'system'`);
      }
      return {
        role: msg.role as ChatMessage['role'],
        content: msg.content.trim()
      };
    });

    if (messages.length === 0) {
      throw new Error('No valid messages provided');
    }

    // Get the latest user message
    const lastUserMessage = messages[messages.length - 1];

    // Perform Tavily search for the user's query
    const tvly = tavily({ apiKey: tavilyKey });
    const searchResponse = await tvly.search(lastUserMessage.content, {
      search_depth: "advanced",
      max_results: 5
    });

    // Add system message with search context if not present
    const systemMessage: ChatMessage = {
      role: 'system',
      content: `You are a highly intelligent and helpful AI assistant. Use the following search results to help answer the user's question, but also include your own knowledge. Search results:\n${JSON.stringify(searchResponse, null, 2)}`
    };

    if (!messages.some(msg => msg.role === 'system')) {
      messages.unshift(systemMessage);
    } else {
      // Update existing system message with search results
      messages[0] = systemMessage;
    }

    console.log('Sending request to Together API');

    // Call Together API with retries
    const payload = {
      model: 'deepseek-ai/DeepSeek-V3',
      messages: messages.map(msg => ({
        role: msg.role,
        content: sanitizeContent(msg.content) // Sanitize all messages before sending
      })),
      temperature: 0.7,
      top_p: 0.95,
      top_k: 50,
      stream: true
    };

    const response = await fetchWithRetries('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // The response is a stream of SSE events
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body received from Together API');
        }

        const decoder = new TextDecoder('utf-8', { fatal: true });
        let buffer = '';

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            try {
              buffer += decoder.decode(value, { stream: true });
            } catch (e) {
              console.warn('Decode error:', e);
              // Try to recover by skipping problematic bytes
              buffer += decoder.decode(value.slice(1), { stream: true });
            }

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim() === '') continue;
              if (!line.startsWith('data: ')) {
                console.warn('Unexpected line format:', line);
                continue;
              }

              const jsonData = line.slice(6);
              if (jsonData === '[DONE]') {
                try {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } catch (e) {
                  console.error('Failed to encode [DONE] message:', e);
                }
                continue;
              }

              try {
                const data = JSON.parse(jsonData);
                let content = data.choices?.[0]?.delta?.content || '';
                content = sanitizeContent(content);

                if (content) {
                  const sseMessage = `data: ${content}\n\n`;
                  controller.enqueue(encoder.encode(sseMessage));
                }
              } catch (e) {
                console.error('Failed to parse or process SSE message:', jsonData, e);
              }
            }
          }
        } catch (error) {
          console.error('Stream processing error:', error);
          controller.error(error);
        } finally {
          reader.releaseLock();
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
        details: error instanceof Error ? {
          name: error.name,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : undefined
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
      }
    );
  }
}
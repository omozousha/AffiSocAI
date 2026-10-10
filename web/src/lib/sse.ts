/**
 * Light SSE parser for POST endpoints using ReadableStream / fetch.
 *
 * EventSource only does GET. For POST /api/links with a body, we read the
 * response stream with fetch + TextDecoder and dispatch lines manually.
 */

export type SSEvent = {
  event: string;
  data: any;
};

export async function postSSE(
  path: string,
  body: unknown,
  onEvent: (e: SSEvent) => void,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let err = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) err = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(err);
  }

  if (!res.body) throw new Error("no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  let currentEvent = "message";
  let currentData = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = (currentData ? currentData + "\n" : "") + line.slice(5).trim();
      } else if (line.trim() === "") {
        // dispatch on empty line
        if (currentData) {
          let parsed = currentData;
          try {
            parsed = JSON.parse(currentData);
          } catch {
            /* leave string */
          }
          onEvent({ event: currentEvent, data: parsed });
        }
        currentEvent = "message";
        currentData = "";
      }
    }
  }

  // flush remainder
  if (currentData) {
    let parsed = currentData;
    try {
      parsed = JSON.parse(currentData);
    } catch {
      /* ignore */
    }
    onEvent({ event: currentEvent, data: parsed });
  }
}

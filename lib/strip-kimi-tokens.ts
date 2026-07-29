import type { TextStreamPart, ToolSet } from 'ai'

// Kimi K2.x (Moonshot) models emit native function-calling delimiters. Because
// we perform web search manually (pre-fetching results and injecting them into
// the prompt) rather than registering AI SDK tools, nothing intercepts these
// tokens and the model's raw tool-call syntax leaks into the visible answer,
// e.g.:
//   <|tool_calls_section_begin|><|tool_call_begin|>functions.search:1
//   <|tool_call_argument_begin|>{"q":"..."}<|tool_call_end|><|tool_calls_section_end|>
//
// This transform strips any tool-call section (and stray individual tokens)
// from the streamed text output. It buffers across chunks so markers that are
// split between two text-deltas are still caught.

const SECTION_START = '<|tool_calls_section_begin|>'
const SECTION_END = '<|tool_calls_section_end|>'

const ALL_TOKENS = [
  SECTION_START,
  SECTION_END,
  '<|tool_call_begin|>',
  '<|tool_call_argument_begin|>',
  '<|tool_call_end|>',
]

const MAX_MARKER_LEN = Math.max(...ALL_TOKENS.map((t) => t.length))

// Upper bound on how much unterminated-section text we hold on to for possible
// salvage. Generated single-file projects run to a few hundred KB, so 4MB is
// ample while still refusing to buffer without limit.
const SALVAGE_CAP = 4_000_000

/**
 * Returns an `experimental_transform` for streamText that removes Kimi/Moonshot
 * tool-call tokens from the visible text stream.
 */
export function stripKimiToolTokens<TOOLS extends ToolSet>() {
  return () => {
    let buffer = ''
    let inSection = false
    let currentId: string | undefined
    // Whether any visible text has been emitted for this response. Used to
    // decide what to do with an unterminated tool-call section at flush time.
    let emittedAny = false

    const emit = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
      raw: string,
    ) => {
      if (!raw) return
      // Safety net: strip any stray individual tokens that slipped through.
      let clean = raw
      for (const tok of ALL_TOKENS) clean = clean.split(tok).join('')
      if (clean && currentId) {
        if (clean.trim()) emittedAny = true
        controller.enqueue({
          type: 'text-delta',
          id: currentId,
          text: clean,
        } as TextStreamPart<TOOLS>)
      }
    }

    const drain = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
      flush: boolean,
    ) => {
      // Keep looping while we can resolve section boundaries in the buffer.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (inSection) {
          const endIdx = buffer.indexOf(SECTION_END)
          if (endIdx === -1) {
            // Still inside a tool-call section: drop buffered content, but
            // retain a small tail in case the end marker is split across chunks.
            if (flush) {
              // Unterminated section at end of stream. If we already emitted
              // real text, this is a normal trailing tool call and dropping it
              // is correct. If we emitted NOTHING, the stream was almost
              // certainly cut off (upstream timeout) and discarding the buffer
              // turns a partial answer into an empty response — the exact
              // "finished without returning a usable project" symptom. Salvage
              // the remainder instead; `emit` strips the delimiters.
              if (!emittedAny && buffer.trim()) {
                inSection = false
                emit(controller, buffer)
              }
              buffer = ''
            } else if (!emittedAny && buffer.length <= SALVAGE_CAP) {
              // Nothing visible has been emitted yet, so this "section" may
              // really be a truncated answer. Retain it (bounded) so the flush
              // branch above has something to salvage. If the section closes
              // normally it is discarded anyway when we slice past SECTION_END.
              return
            } else {
              const keep = Math.min(buffer.length, SECTION_END.length - 1)
              buffer = buffer.slice(buffer.length - keep)
            }
            return
          }
          buffer = buffer.slice(endIdx + SECTION_END.length)
          inSection = false
          continue
        }

        const startIdx = buffer.indexOf(SECTION_START)
        if (startIdx !== -1) {
          emit(controller, buffer.slice(0, startIdx))
          buffer = buffer.slice(startIdx + SECTION_START.length)
          inSection = true
          continue
        }
        break
      }

      // No (complete) section markers left in the buffer.
      if (flush) {
        emit(controller, buffer)
        buffer = ''
        return
      }

      // Hold back a tail that could be the start of a split marker.
      const keep = Math.min(buffer.length, MAX_MARKER_LEN - 1)
      const emitLen = buffer.length - keep
      if (emitLen > 0) {
        emit(controller, buffer.slice(0, emitLen))
        buffer = buffer.slice(emitLen)
      }
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === 'text-delta') {
          currentId = chunk.id
          buffer += chunk.text
          drain(controller, false)
          return
        }
        if (chunk.type === 'text-end') {
          drain(controller, true)
          controller.enqueue(chunk)
          return
        }
        controller.enqueue(chunk)
      },
      flush(controller) {
        drain(controller, true)
      },
    })
  }
}

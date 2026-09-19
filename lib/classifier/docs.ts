/**
 * The documentation, as plain text with UPPERCASE headings. `curl /api/jex`
 * prints it as-is; the /jex page renders the same document, so the two
 * cannot drift. Adapted from classifier.dev's own docs to this site's routes
 * and to what this port measures rather than what the original did.
 */
import { MAX_INPUTS_PER_REQUEST, MAX_LABELS, MAX_CHARS, TIERS } from './core'

export const API_PATH = '/api/jex'

export const docs = (origin: string) => `jex

Zero-shot text classification over plain HTTP. You send text and a list of
labels, you get back the label that fits and how sure the model is. There is no
API key and no account, so the example below works the moment you paste it.

jex is a clone of classifier.dev (github.com/mrmps/classifier-dev), answered
by Kimi K3 on Engy.


USAGE

  GET  ${origin}${API_PATH}/{labels}/{text}
  GET  ${origin}${API_PATH}?labels={a,b}&text={text}
  POST ${origin}${API_PATH}  {"input":"...","labels":["...","..."]}
  POST ${origin}${API_PATH}  {"inputs":["...", ...up to ${MAX_INPUTS_PER_REQUEST}],"labels":[...]}


EXAMPLES

  curl ${origin}${API_PATH}/spam,not+spam/Win+a+free+iPhone+now
  spam

  curl ${origin}${API_PATH} -d '{
    "input": "the checkout button does nothing",
    "labels": ["bug", "feature", "praise"]
  }'
  {
    "tier": "fast", "model": "engy/kimi-k3",
    "modelsUsed": ["engy/kimi-k3"],
    "results": [{
      "label": "bug", "confidence": 0.9987,
      "scores": {"bug": 0.9987, "feature": 0.0011, "praise": 0.0002},
      "ms": 1200, "model": "engy/kimi-k3"
    }],
    "usage": {"classifications": 1, "escalated": 0, "ms": 1200}
  }

  curl "${origin}${API_PATH}/entailment,neutral,contradiction/Only+12+of+40+sites+were+inspected.+Every+site+was+inspected."
  contradiction

  Spaces can be written as + or %20, and labels are separated by commas.

  The same request as query parameters, for code that builds URLs:

  curl "${origin}${API_PATH}?labels=spam,not+spam&text=Win+a+free+iPhone+now"
  spam

  input, q, classes and categories are read as text and labels too, and the
  two forms mix: /spam,not+spam?text=... is the same call. Every option below
  works on both. A malformed GET answers with a URL that would have worked.

  In the path form a raw comma, slash or plus sign is a separator. A label
  that contains one is written percent-encoded, %2C, %2F or %2B, so
  /C%2B%2B,python/... reads the label C++. In the query form + is a space and
  %2B a plus sign, and a comma inside a label is written %252C.


PARAMETERS

  labels        Two to ${MAX_LABELS} categories. Required.
  input         The text to classify, up to ${MAX_CHARS.toLocaleString('en-US')} characters.
  inputs        Up to ${MAX_INPUTS_PER_REQUEST} strings classified in a single call.
  tier          Either fast (the default) or smart, in any case. Anything
                else is a 400 with code bad_tier, never a silent fast.
  instructions  Extra criteria, such as "judge the reviewer's overall verdict".
  verbose       On GET requests, ?verbose=1 returns JSON instead of a bare label.
                Sending Accept: application/json does the same.
  multi         Return every category that applies instead of just one.
  max_labels    Cap how many multi-label answers come back.

  Results come back in input order. Each carries the label, a confidence from
  0 to 1, a score for every label, and the model that answered.

  Batch responses also carry modelsUsed. The top-level model is "mixed" when
  different results were answered by different models, such as a smart-tier
  batch where only some inputs were escalated.


CONFIDENCE

  Every answer is a JSON object from Kimi K3: the label, and a probability
  for every label, normalised to sum to one. The confidence is
  the probability the model put on the label it chose. It is the model's own
  stated calibration rather than a measured logprob, so treat it as a strong
  ordering signal and set thresholds against your own data.

  Use it. Act on high-confidence answers, and route the rest to a person or
  to the smart tier, which spends more reasoning on every answer.

  Three things confidence does not measure.

  It is not out-of-distribution detection. It says which of your labels fits
  best, not whether any of them fit. "The weather is nice today" against
  bug / feature / praise comes back "praise", with a confidence that looks
  like any other answer's. If none-of-the-above is a real outcome, add it as
  a label: the same text against those three plus "none of these" picks
  "none of these". That works; hoping for a low score does not.

  It is withheld for input that is not language. A forced choice on
  "asdkjfhaskdjfh" still lands somewhere, so the label ships with confidence
  and scores null and an unscored field explaining why.

  It is withheld when a fallback provider answered without logprobs. The
  label is still that model's answer; confidence and scores are null rather
  than invented, and the model field says which provider it was.


MULTI-LABEL

  One article, fifty tags, the ones that fit:

    curl ${origin}${API_PATH} -d '{
      "input": "...",
      "labels": ["ml", "databases", "... up to ${MAX_LABELS} ..."],
      "multi": true, "max_labels": 10
    }'
    {"results": [{
      "labels": ["databases", "serverless", "rust", "caching", ...],
      "scores": {"databases": 0.98, "serverless": 0.95, ..., "gaming": 0.01}
    }]}

  On GET, add ?multi=1 and the labels come back one per line.

  Every label is judged independently as a yes/no probability, and the answer
  lists those at or above 0.7, most likely first. The full score map is
  returned so you can set your own threshold. max_labels keeps the top N.


TIERS

  fast     Kimi K3 with thinking off: one round trip, a second or two.

  smart    The same model with a reasoning budget, so it thinks before it
           answers. A few seconds per item. Multi-label answers ignore the
           tier.

  Both tiers answer from engy/kimi-k3. If a request to it fails, or no Engy
  key is configured, a chain of OpenAI-compatible providers answers instead
  (OpenRouter when a key is set, then Chutes, Targon and Engy GLM); on
  that chain the smart tier re-asks answers below 0.7 confidence of a
  reasoning model and marks them escalated: true. JSON responses always
  report which model actually answered.


LIMITS

  Limits are counted per IP address in classifications, not requests, so a
  batch of fifty inputs spends fifty of them. The fast tier allows
  ${TIERS.fast.rpm.toLocaleString('en-US')} per minute and ${TIERS.fast.daily.toLocaleString('en-US')} per day; the smart tier ${TIERS.smart.rpm} per minute and ${TIERS.smart.daily.toLocaleString('en-US')}
  per day. A batch must fit the remaining quota in full.

  Each input is capped at ${MAX_CHARS.toLocaleString('en-US')} characters, and a request may carry up to
  ${MAX_INPUTS_PER_REQUEST} inputs. Every classification response carries RateLimit-Limit and
  RateLimit-Remaining. Exceeding a limit returns 429 with a Retry-After header.
  Nothing is slowed down or silently dropped.


ERRORS

  A POST that fails answers JSON with a message and a stable code:

    {"error": "Provide at least 2 labels; got 1 (\\"spam\\").", "code": "too_few_labels"}

  The GET forms answer plain text instead, an error: line and, on a 400, the
  usage: and try: lines with a URL that would have worked; add ?verbose=1 or
  send Accept: application/json for the JSON object, which then carries usage
  and try as fields.

  400   bad_json, no_input, too_many_inputs, too_few_labels, too_many_labels,
        empty_label, duplicate_labels, empty_input, input_too_long, bad_tier
  404   not_found
  429   rate_limit_minute, rate_limit_day, with Retry-After
  502   chain_exhausted or timeout when every provider failed; upstream_other.
        Retry with backoff.
  503   no_provider when no inference key is configured on the server.


SOURCE

  This is a port of classifier.dev, MIT licensed, by Michael Ryaboy:
  https://github.com/mrmps/classifier-dev
  The original answers from a calibrated decision model and runs as a single
  Cloudflare Worker with a CLI and an MCP server; this clone keeps its HTTP
  surface and answers from Kimi K3 on Engy.
`

export const isHeading = (l: string) => /^[A-Z][A-Z0-9 ,/()'-]{2,}$/.test(l) && l.trim() === l

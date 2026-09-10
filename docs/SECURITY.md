# Security

The threat model, the controls, and the honest limits are in
[`../SECURITY.md`](../SECURITY.md) at the repository root, where GitHub
surfaces it as the project's security policy.

Short version:

- Policy is a pure, deterministic function on the server. The model never
  decides.
- Every human action is signed by the acting wallet and verified by the
  gateway: signer must match, ten-minute validity, content digest for
  payload-carrying actions, each signature usable once.
- Prices come from the stored request, never the caller. Policy is
  re-evaluated before a price is quoted and again at release.
- Money is integer micro-USD. Spend is recorded at collection. Payment nonces
  are single-use. Submissions are idempotent.
- Untrusted structured input is validated and clamped. Model output is
  re-validated and grounding-checked.
- Identity fails closed when ENS is configured and unreachable.
- Agents are rate-limited per passport; humans per caller.
- No custody, no keys in the gateway, no transaction ever sent by it.

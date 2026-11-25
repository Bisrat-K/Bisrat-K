// Bundle entry for the claude.ai-hosted page. artifact-transport.js installs
// the transport (Claude via `sample`, private page storage) before app.js boots.
import "./artifact-transport.js";
import "../public/app.js";

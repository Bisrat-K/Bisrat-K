// Bundle entry for the phone build. Order matters: standalone.js installs the
// in-browser transport before app.js boots.
import "./standalone.js";
import "../public/app.js";

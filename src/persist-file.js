// Server-side persistence: ./data/state.json (written atomically).
import fs from "node:fs";
import path from "node:path";

export function filePersist(dir) {
  const file = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    load() {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
    save(state) {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

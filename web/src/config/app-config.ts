import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "bypass",
  version: packageJson.version,
  copyright: `© ${currentYear}, bypass.`,
  meta: {
    title: "bypass — Autonomous Penetration Testing Console",
    description: "Console for the LLM-driven autonomous penetration testing system",
  },
};

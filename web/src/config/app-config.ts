import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "reverse bypass",
  version: packageJson.version,
  copyright: `© ${currentYear}, reverse bypass.`,
  meta: {
    title: "reverse bypass — Autonomous Penetration Testing Console",
    description: "Console for the LLM-driven autonomous penetration testing system",
  },
};

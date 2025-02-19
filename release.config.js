module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "feat!", release: "major" },
          { type: "fix", release: "patch" },
          { type: "fix!", release: "major" },
          { type: "docs", release: false },
          { type: "style", release: false },
          { type: "refactor", release: "patch" },
          { type: "refactor!", release: "major" },
          { type: "perf", release: "patch" },
          { type: "perf!", release: "major" },
          { type: "test", release: false },
          { type: "build", release: "patch" },
          { type: "build!", release: "major" },
          { type: "ci", release: false },
          { type: "chore", release: false },
          { type: "revert", release: "patch" },
          { type: "revert!", release: "major" },
        ],
        parserOpts: {
          noteKeywords: ["BREAKING CHANGE"],
        },
      },
    ],
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        changelogFile: "CHANGELOG.md",
      },
    ],
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json", "pnpm-lock.yaml"],
        message: "chore(release): ${nextRelease.version}",
      },
    ],
  ],
};
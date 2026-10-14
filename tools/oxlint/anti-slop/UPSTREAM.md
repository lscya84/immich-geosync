# Upstream provenance

- Source: https://github.com/dmmulroy/anti-slop
- Exact source commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- Copied from: `skills/install-anti-slop/assets/anti-slop/` at that commit.
- Installed path: `tools/oxlint/anti-slop/`.
- Source modifications: no upstream implementation changes. Added a private type=module package boundary for Node.js TypeScript loading. The nested eslint-stylistic license/provenance is preserved.
- Dependency pair: oxlint and @oxlint/plugins pinned to 1.88.0.
- Generic rules: all 18 enabled as error, plus oxc/no-accumulating-spread.
- Effect rules: not enabled without a direct Effect dependency.
- Verification: configuration loading, full source scan, and accepted/rejected examples are run during rollout. Existing application findings are reported separately; do not interpret installation as a clean source scan.

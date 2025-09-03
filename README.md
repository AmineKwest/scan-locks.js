# scan-locks

A Node.js script to recursively search for `package-lock.json`, `yarn.lock` (Yarn v1), and `package.json` files inside one or more directories, and report occurrences of specific packages in a Markdown table.

---

## Features

- Recursively scans subdirectories for dependency lock files.
- Supports:
  - **npm lockfiles** (`package-lock.json`, `package.lock.json`)  
  - **Yarn v1 lockfiles** (`yarn.lock`)  
  - **package.json** dependency declarations
- Extracts occurrences of a predefined set of packages:
  - `eslint-config-prettier`
  - `eslint-plugin-prettier`
  - `synckit`
  - `@pkgr/core`
  - `napi-postinstall`
  - `got-fetch`
  - `is`
- Outputs results in a **Markdown table**:
  - Package name  
  - Version  
  - Dev / Optional flags  
  - Source (npm-lock, yarn-lock, package-json)  
  - File path  

---

## Requirements

- **Node.js** v14 or higher  
  Check with:
  ```bash
  node -v
  ```

---

## Installation

Clone or copy the script to your project:

```bash
git clone <your-repo-url>
cd <your-repo>
```

Make the script executable (optional):

```bash
chmod +x scan-locks.js
```

---

## Usage

1. Edit the list of directories to scan in the script:

   ```js
   // Example in scan-locks.js
   const ROOTS = [
     'src',
     'app',
     '/absolute/path/to/another/project',
   ];
   ```

2. Run the script:

   ```bash
   node scan-locks.js
   ```

3. Results will be printed as a Markdown table, for example:

   ```markdown
   | Package | Version | Dev | Optional | Source | File |
   |---|---|:---:|:---:|---|---|
   | `eslint-config-prettier` | `9.1.0` |  |  | yarn-lock | `app/web/core/yarn.lock` |
   | `eslint-plugin-prettier` | `5.4.1` |  |  | yarn-lock | `app/web/core/yarn.lock` |
   | `synckit` | `0.11.8` |  |  | yarn-lock | `app/web/core/yarn.lock` |
   ```

---

## Notes

- Yarn v2/v3 (Berry) lockfiles are not supported, since they use a different YAML format.  
- For `package.json`, the script shows declared dependency ranges (e.g. `^9.0.0`), not locked versions.  
- Add or remove packages of interest by editing the `TARGETS` set at the top of the script.  

---

## License

MIT

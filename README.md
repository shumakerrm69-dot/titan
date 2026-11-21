# TITAN AI — GitHub Pages deployment package

This package is prepared for deployment as a GitHub Pages project site.

## Publish the website

1. Create a new GitHub repository named `titan` (or another name you prefer).
2. Upload the **contents** of this ZIP to the repository's top level. In particular, `package.json`, `index.html`, `client/`, `public/`, and `.github/` should be visible at the repository root.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. Open the **Actions** tab and wait for **Deploy TITAN to GitHub Pages** to finish.
6. Your site address will be shown in the workflow's deployment result and in **Settings → Pages**.

The workflow builds the Vite app and publishes its `dist/` folder. It uses a relative asset base and a project-site-aware manifest/service worker so the app can run under a repository URL such as `https://YOUR-USERNAME.github.io/titan/`.

## Important: website hosting is not AI hosting

GitHub Pages only hosts static website files. It cannot run TITAN's Express/Node API server. The chat, web search, and server-based audio transcription require the included `server/` to run on a separate Node.js host and require a server-side `OPENAI_API_KEY`.

After deploying the API server separately:
1. In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables**.
2. Add a repository variable named `VITE_API_BASE_URL` with the public HTTPS base URL of the API server (no trailing slash).
3. Push a new commit or manually rerun the deployment workflow.

Do not put `OPENAI_API_KEY` in GitHub Pages, `VITE_API_BASE_URL`, or any frontend file. Set `OPENAI_API_KEY` only as a private environment variable on the API host. The API may incur usage charges.

## Local development

- Requires Node.js 20+
- Run `npm install`
- Copy `.env.example` to `.env` and set `OPENAI_API_KEY`
- Run `npm run dev`
- Open the Vite URL, usually `http://localhost:5173`

The Vite development server proxies `/api` requests to `http://localhost:3001`.

## Included functionality and limitations

- React TITAN interface
- OpenAI Responses API chat through the private Express server
- Optional web search through the API
- Browser-local chat history
- Browser voice input/output
- PWA manifest, service worker, and app icons
- Image understanding, image generation, file analysis, user accounts, and cloud-synced memory are not implemented in this release

API usage may cost money. Hosting the site on GitHub Pages is free within GitHub's applicable limits, but it does not make the AI API free.

# Sage Website

The marketing and documentation landing page for [Sage](https://github.com/BokX1/Sage) — the first autonomous AI community engineer.

Built with [Astro](https://astro.build), React, Framer Motion, and Tailwind CSS v4.

## 🧞 Commands

All commands are run from the `website/` directory:

| Command             | Action                                       |
| :------------------ | :------------------------------------------- |
| `npm install`       | Install dependencies                         |
| `npm run dev`       | Start local dev server at `localhost:4321`    |
| `npm run build`     | Build production site to `./dist/`           |
| `npm run typecheck` | Run TypeScript checks (`--noEmit`)           |
| `npm run check`     | Run full validation (`typecheck` + `build`)  |
| `npm run preview`   | Preview production build locally             |

## 🚀 Project Structure

```text
website/
├── public/           # Static assets (favicon, og-image)
├── src/
│   ├── components/   # React interactive components
│   ├── layouts/      # Astro layout (Layout.astro)
│   ├── pages/        # Page routes (index.astro)
│   └── styles/       # Global CSS (design system V3)
└── package.json
```

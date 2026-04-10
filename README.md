## Front matter

This is a vibe-coded webapp using Claude produced in ~3 hours. The initial app was seeded by a hand-written python file (`make_ldpc_code.py`) and then converted. The intent is to make a puzzle game where the user tries to identify the errors on a classical ldpc code by minimizing the number of parity check errors.

Disclaimer: everything is vibe coded and thus possibly slop. The graph generation is just an Edros-Renyi random Tanner graph with no guarantees of code distance or encoding rate, and the hidden noise is produced purely randomly with no notion of any code distance. Generally decoding these graphs is really hard, which can be frustrating. A future To Do is to make more structured ldpc instances (think something like a {classical} surface code or algebraic constructions) that have some notion of an actual code distance and decoding hardness.


## AI boilerplate:

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

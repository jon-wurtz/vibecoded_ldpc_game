## Front matter

This is a vibe-coded webapp made by Claude and @jon-wurtz. The idea is to make a game in which the player is a decoder. The user is given a Tanner graph of parity check nodes (gray) and data nodes (purple). A hidden error is generated, triggering some of the parity check nodes (orange). The goal of the user is to identify the errors that occured by clicking on the data nodes to remove the parity checks.

There are a selection of several graphs:
- Hamming [7,4,3]: the "smallest perfect code" able to decode one error
- Reed-Muller [32,6,16]: more or less impossible to decode via the Tanner graph due to it not being very low density, but serves as a useful example for a working code. It has a very high distance and decent rate, and has been used on deep space probes!
- Repetition [7,1,7]: First academic excercise to explain decoding. Notibly, the decoding is /not/ majority vote!
- McGee graph [24,13,7]: A graph code (each error fires exactly two syndromes) based on the (3,7) cage graph. Useful because its rather large but still decodable by hand with a large distance. To Do to make another larger graph code with higher distance to make decoding more interesting.
- Surface code [[49,1,7]]: The canonical quantum code, with both X and Z errors (and, likewise, X and Z parity checks). Still a little bit buggy-- I'm a bit suspicious about the validation of logical errors.

### To Dos:
- Write some tutorial text that points out what a Tanner graph, decoder, error correction, etc. is
- Find another relatively easy large code that is close to matching but not exactly (so hard to decode) while remaining quasi-local
- Add small quantum codes, such as BB codes.

### WARNING:
Most of this is vibe coded, with some hand-coding for graphs. The surface code (and general quantum codes) are still a little buggy and need some care to fix.


# AI boilerplate:

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

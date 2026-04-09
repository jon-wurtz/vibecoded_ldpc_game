import LdpcGraph from "./ldpc-graph";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-4 pt-5 pb-2 font-sans">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-[#a78bfa] via-[#818cf8] to-[#6366f1] bg-clip-text text-3xl font-bold tracking-tight text-transparent">
          LDPC Code Visualizer
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Generate and explore low-density parity-check codes interactively
        </p>
      </div>
      <LdpcGraph />
    </div>
  );
}

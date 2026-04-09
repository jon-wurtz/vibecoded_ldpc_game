import LdpcGraph from "./ldpc-graph";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden px-4 py-4 font-sans">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">LDPC Code Visualizer</h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          Generate and explore low-density parity-check codes interactively
        </p>
      </div>
      <LdpcGraph />
    </div>
  );
}

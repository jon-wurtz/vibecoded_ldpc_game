import LdpcGraph from "./ldpc-graph";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-4 pt-5 pb-2 font-sans">
      <div className="max-w-2xl text-center">
        <h1 className="bg-gradient-to-r from-[#a78bfa] via-[#818cf8] to-[#6366f1] bg-clip-text text-3xl font-bold tracking-tight text-transparent">
          Find the Errors in the Code!
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Click on the white nodes to change the check nodes, which compute the parity of the connected data nodes. Minimize the number of orange nodes to win!
        </p>
      </div>
      <LdpcGraph />
    </div>
  );
}

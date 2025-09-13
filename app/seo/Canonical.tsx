import Head from "next/head";

export default function Canonical({ url }: { url: string }) {
  return (
    <Head>
      <link rel="canonical" href={url} />
    </Head>
  );
}

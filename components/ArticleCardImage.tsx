// components/ArticleCardImage.tsx
import Image from "next/image";
import { useState } from "react";

export default function ArticleCardImage({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <Image
      src={src}
      alt={alt}
      width={1200}
      height={630}
      className="w-full h-auto rounded-lg"
      onError={() => setOk(false)}
      priority={false}
    />
  );
}

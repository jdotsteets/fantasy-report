// components/Hero.tsx
import Image from "next/image";
import Link from "next/link";

export type HeroProps = {
  title: string;
  href: string;     // link to article
  src?: string;     // image URL (og:image or fallback)
  source: string;   // publisher label
};

const FALLBACK = "https://picsum.photos/1600/900";

export default function Hero({ title, href, src, source }: HeroProps) {
  const img = src || FALLBACK;

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-lg border border-zinc-200 bg-white hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-[16/9] w-full">
        <Image
          src={img}
          alt={title}
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover"
          priority
        />
      </div>

      <div className="p-3">
        <div className="text-xs text-zinc-500">{source}</div>
        <h3 className="mt-1 line-clamp-2 text-base font-medium text-zinc-900 group-hover:underline">
          {title}
        </h3>
      </div>
    </Link>
  );
}
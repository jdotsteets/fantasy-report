// components/SmartImage.tsx
"use client";

import Image, { type ImageProps } from "next/image";
import { useState, useMemo } from "react";

type Props = Omit<ImageProps, "src"> & { src: string };

export default function SmartImage({ src, alt, ...rest }: Props) {
  const [fallback, setFallback] = useState(false);

  const proxied = useMemo(
    () => `/api/img?u=${encodeURIComponent(src)}`,
    [src]
  );

  // Data/blob URLs should skip <Image> anyway
  const isData = /^data:|^blob:/i.test(src);

  if (isData) {
    // Simple <img> for data/blob URIs
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...(rest as any)} />;
  }

  // If Next/Image failed (blocked host/403), use our proxy
  if (fallback) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={proxied} alt={alt} {...(rest as any)} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      onError={() => setFallback(true)}
      {...rest}
    />
  );
}

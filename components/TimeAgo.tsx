// TimeAgo.tsx - Shows relative time ("2h ago")
"use client";

import { useEffect, useState } from "react";

function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "Yesterday";
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
}

export default function TimeAgo({ date, className = "" }: { date: string | Date; className?: string }) {
  const [timeAgo, setTimeAgo] = useState(formatTimeAgo(date));
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(date));
    }, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, [date]);
  
  return (
    <time className={className} dateTime={new Date(date).toISOString()}>
      {timeAgo}
    </time>
  );
}

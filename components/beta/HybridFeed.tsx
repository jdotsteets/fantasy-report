"use client";

import { useSearchParams } from "next/navigation";
import type { Article } from "@/types/sources";
import { getTeamById, filterArticlesByTeam } from "@/lib/teams";
import FilterBanner from "@/components/beta/FilterBanner";
import BetaLoadMoreSection from "@/components/beta/BetaLoadMoreSection";

interface SectionData {
  title: string;
  subtitle: string;
  sectionKey: "news" | "rankings" | "start-sit" | "waiver-wire" | "dfs" | "injury" | "advice";
  articles: Article[];
  pageSize?: number;
  initialDisplay?: number;
  variant?: "feed" | "headlines";
}

interface HybridFeedProps {
  sections: SectionData[];
}

export default function HybridFeed({ sections }: HybridFeedProps) {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("team");
  const selectedTeam = teamId ? getTeamById(teamId) : null;

  if (!selectedTeam) {
    // No filter - show normal sections
    return (
      <>
        {sections.map((section, idx) => (
          <BetaLoadMoreSection
            key={`${section.sectionKey}-${idx}`}
            title={section.title}
            subtitle={section.subtitle}
            sectionKey={section.sectionKey}
            initialItems={section.articles}
            pageSize={section.pageSize ?? 10}
            initialDisplay={section.initialDisplay ?? 4}
            variant={section.variant}
          />
        ))}
      </>
    );
  }

  // Filter each section
  const filteredSections = sections.map(section => ({
    ...section,
    filteredArticles: filterArticlesByTeam(section.articles, teamId),
  }));

  const totalFilteredCount = filteredSections.reduce((sum, s) => sum + s.filteredArticles.length, 0);

  return (
    <div className="space-y-6">
      <FilterBanner team={selectedTeam} matchCount={totalFilteredCount} />

      {totalFilteredCount > 0 && (
        <>
          <div className="mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 mb-4">
              {selectedTeam.shortName}-Specific Content
            </h3>
            <div className="space-y-6">
              {filteredSections
                .filter(s => s.filteredArticles.length > 0)
                .map((section, idx) => (
                  <BetaLoadMoreSection
                    key={`${section.sectionKey}-filtered-${idx}`}
                    title={`${section.title} (${section.filteredArticles.length})`}
                    subtitle={section.subtitle}
                    sectionKey={section.sectionKey}
                    initialItems={section.filteredArticles}
                    pageSize={section.pageSize ?? 10}
                    initialDisplay={section.filteredArticles.length} // Show all filtered results
                    variant={section.variant}
                  />
                ))}
            </div>
          </div>

          <div className="border-t-2 border-zinc-200 pt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 mb-4">
              More NFL News
            </h3>
          </div>
        </>
      )}

      {/* Always show general feed below */}
      <div className={totalFilteredCount > 0 ? "opacity-75" : ""}>
        {sections.map((section, idx) => (
          <BetaLoadMoreSection
            key={`${section.sectionKey}-general-${idx}`}
            title={section.title}
            subtitle={section.subtitle}
            sectionKey={section.sectionKey}
            initialItems={section.articles}
            pageSize={section.pageSize ?? 10}
            initialDisplay={section.initialDisplay ?? 4}
            variant={section.variant}
          />
        ))}
      </div>
    </div>
  );
}

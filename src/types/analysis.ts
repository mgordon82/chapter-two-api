export interface ChapterTwoAnalysis {
  analysisSummary: string;
  unfairnessScore: number;
  factors: {
    label: string;
    description: string;
    weight: number;
  }[];
  suggestions: string[];
  resourceLinks: {
    label: string;
    url: string;
  }[];
  reframes: string[];
  safetyNotes?: string[];
  metadata: {
    storyLength: number;
    receivedAt: string;
    context?: any;
    model?: string;
  };
}

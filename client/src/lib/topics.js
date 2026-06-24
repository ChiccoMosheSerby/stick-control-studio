// The book's sections, in order, as topics for the studio.
// `section` matches the `section` field on each exercise in exercises.json, so a
// topic's exercises are simply library.filter(e => e.section === topic.section).
// Every topic is selectable; a topic with no exercises yet shows a "soon"
// placeholder in the notation box instead of a carousel. `enabled: false` would
// hide a topic from the strip entirely (none are hidden today). `pdfPages` is the
// 1-based page range in StickControl.pdf, kept for the offline build tools.
export const TOPICS = [
  { id: "single-beat",            name: "Single Beat Combinations",                 section: "Single Beat Combinations",                 pdfPages: [7, 9],   enabled: true  },
  { id: "triplets",               name: "Triplets",                                 section: "Triplets",                                 pdfPages: [10, 11], enabled: true  },
  { id: "short-roll-single",      name: "Short Roll Combinations (Single Beat Rolls)", section: "Short Roll Combinations (Single Beat Rolls)", pdfPages: [12, 12], enabled: true  },
  { id: "short-roll-double",      name: "Short Roll Combinations (Double Beat Rolls)", section: "Short Roll Combinations (Double Beat Rolls)", pdfPages: [13, 13], enabled: true  },
  { id: "short-roll",             name: "Short Roll Combinations",                  section: "Short Roll Combinations",                  pdfPages: [14, 14], enabled: true  },
  { id: "short-roll-review",      name: "Review of Short Roll Combinations",        section: "Review of Short Roll Combinations",        pdfPages: [15, 15], enabled: true  },
  { id: "short-rolls-triplets",   name: "Short Rolls and Triplets",                 section: "Short Rolls and Triplets",                 pdfPages: [16, 17], enabled: true  },
  { id: "flam-beats",             name: "Flam Beats",                               section: "Flam Beats",                               pdfPages: [18, 25], enabled: true  },
  { id: "short-rolls-68",         name: "Short Rolls in 6/8",                       section: "Short Rolls in 6/8",                       pdfPages: [26, 29], enabled: true  },
  { id: "short-rolls-68-review",  name: "Review of Short Rolls in 6/8",             section: "Review of Short Rolls in 6/8",             pdfPages: [30, 31], enabled: true  },
  { id: "combinations-38",        name: "Combinations in 3/8",                      section: "Combinations in 3/8",                      pdfPages: [32, 34], enabled: true  },
  { id: "combinations-24",        name: "Combinations in 2/4",                      section: "Combinations in 2/4",                      pdfPages: [35, 35], enabled: true  },
  { id: "flam-triplets",          name: "Flam Triplets and Dotted Notes",           section: "Flam Triplets and Dotted Notes",           pdfPages: [36, 39], enabled: true  },
  { id: "short-roll-prog",        name: "Short Roll Progressions",                  section: "Short Roll Progressions",                  pdfPages: [40, 45], enabled: true  },
  { id: "short-roll-prog-trip",   name: "Short Roll Progressions and Triplets",     section: "Short Roll Progressions and Triplets",     pdfPages: [46, 48], enabled: true  },
];

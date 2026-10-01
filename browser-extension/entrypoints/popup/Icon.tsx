const paths = {
  swap: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
  compare: "M12 3v18M4 5h4v14H4zM16 5h4v14h-4z",
  grid: "M3 3h6v6H3V3ZM15 3h6v6h-6V3ZM3 15h6v6H3v-6ZM15 15h6v6h-6v-6Z",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5",
  maximize: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
  expand: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6",
  plus: "M12 4v16M4 12h16",
  close: "m6 6 12 12M6 18 18 6",
  chevronDown: "m6 9 6 6 6-6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  history: "M3 7h6l2 2h10v11H3V7ZM3 7V4h7l2 3h7v2",
  back: "m10 5-7 7 7 7M3 12h18",
  copy: "M9 9h11v11H9V9ZM15 5V3H3v12h2",
  check: "m5 12 4 4L19 6",
  image: "M3 3h18v18H3V3Zm0 13 6-6 6 6 3-3 3 3M15 7h.01",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
};

export default function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

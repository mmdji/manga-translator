/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'manga-primary': '#38bdf8', // Cyan
        'manga-accent': '#c084fc',  // Purple
        'manga-dark': '#0f172a',
      }
    },
  },
  plugins: [],
}
/** @type {import('tailwindcss').Config} */

export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        'desert': '#173A8D',
        'desert-green-light': '#DFE6FA',
        'watchman-navy': '#173A8D',
        'watchman-red': '#BD1128',
        'watchman-neutral-100': '#F8FAFC',
        'watchman-neutral-200': '#E5E7EB',
        'watchman-neutral-500': '#9CA3AF',
        'watchman-neutral-700': '#4B5563',
        'watchman-neutral-900': '#111827',
      },
    },
  },
}

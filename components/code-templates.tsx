'use client'

import {
  LayoutTemplate,
  UserRound,
  HelpCircle,
  Calculator,
  ListChecks,
  Timer,
  UtensilsCrossed,
  Images,
  type LucideIcon,
} from 'lucide-react'

export type CodeTemplate = {
  icon: LucideIcon
  title: string
  description: string
  prompt: string
}

// Starter templates for BlueTAO Code. Each one carries a rich, plain-English
// prompt so a non-programmer gets a genuinely complete app on the first try.
export const CODE_TEMPLATES: CodeTemplate[] = [
  {
    icon: LayoutTemplate,
    title: 'Landing Page',
    description: 'A modern one-page site for a product or startup',
    prompt:
      'Build a modern, responsive landing page for a startup. Include a hero section with a headline, subheadline and a call-to-action button, a features section with 3 feature cards and icons, a testimonials section, a pricing section with 3 tiers, and a footer. Use a clean, professional design with a cohesive color scheme and smooth hover effects.',
  },
  {
    icon: UserRound,
    title: 'Portfolio',
    description: 'A personal site to show off your work',
    prompt:
      'Build a personal portfolio website. Include a header with my name and navigation, an about section with a short bio, a projects grid showing 6 project cards with title, description and a link, a skills section, and a contact section with a simple form. Make it visually polished, responsive, and include a light/dark mode toggle.',
  },
  {
    icon: HelpCircle,
    title: 'Quiz Game',
    description: 'An interactive multiple-choice quiz',
    prompt:
      'Build an interactive multiple-choice quiz game with 8 general-knowledge questions. Show one question at a time with 4 answer buttons, highlight correct and incorrect answers when clicked, keep a running score, show a progress bar, and display a final results screen with the score and a "Play again" button. Make it fun and colorful.',
  },
  {
    icon: Calculator,
    title: 'Calculator',
    description: 'A working calculator with a clean keypad',
    prompt:
      'Build a fully working calculator with a clean keypad UI. Support addition, subtraction, multiplication, division, decimals, percentage, clear, and delete. Show the current expression and result on a display. Make sure the arithmetic is correct, handle divide-by-zero gracefully, and support keyboard input.',
  },
  {
    icon: ListChecks,
    title: 'To-Do List',
    description: 'Add, complete, and delete tasks',
    prompt:
      'Build a to-do list app. Let me add tasks with an input and Enter key, mark tasks complete with a checkbox (with a strikethrough style), delete tasks, and filter by All / Active / Completed. Show a count of remaining tasks and persist the tasks in the browser so they survive a refresh. Make it clean and satisfying to use.',
  },
  {
    icon: Timer,
    title: 'Countdown Timer',
    description: 'A countdown to any date or event',
    prompt:
      'Build a countdown timer to a specific date and event. Let me enter an event name and a target date, then show a live countdown of days, hours, minutes and seconds in large styled digits that update every second. Show a celebration message when the countdown reaches zero. Make it elegant and centered.',
  },
  {
    icon: UtensilsCrossed,
    title: 'Restaurant Menu',
    description: 'A styled menu with categories and prices',
    prompt:
      'Build a restaurant menu website. Include a hero with the restaurant name and tagline, menu categories (Starters, Mains, Desserts, Drinks) with items showing name, description and price, and a reservation section with a simple booking form. Use warm, appetizing colors and a refined layout that works on mobile.',
  },
  {
    icon: Images,
    title: 'Photo Gallery',
    description: 'A responsive image grid with a lightbox',
    prompt:
      'Build a responsive photo gallery with a masonry-style grid of placeholder images. Clicking an image opens a lightbox overlay with the enlarged image, a caption, and previous/next navigation plus a close button. Support keyboard arrows and Escape. Make it smooth and modern.',
  },
]

export function CodeTemplates({
  onSelect,
}: {
  onSelect: (prompt: string) => void
}) {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LayoutTemplate className="h-4 w-4 text-sky-500" />
        <span>Start from a template, then describe your changes</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CODE_TEMPLATES.map((template) => (
          <button
            key={template.title}
            type="button"
            onClick={() => onSelect(template.prompt)}
            className="group flex flex-col items-start gap-2 rounded-2xl border border-border/50 bg-card/80 p-4 text-left backdrop-blur-sm transition-all hover:border-sky-400/50 hover:bg-accent"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 transition-colors group-hover:bg-sky-500/20 dark:text-sky-400">
              <template.icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-foreground">{template.title}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {template.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

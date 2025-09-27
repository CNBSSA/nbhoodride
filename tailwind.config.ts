import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        pulse: {
          "0%": {
            boxShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0 rgba(46, 125, 50, 0.7)",
          },
          "70%": {
            boxShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 20px rgba(46, 125, 50, 0)",
          },
          "100%": {
            boxShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0 rgba(46, 125, 50, 0)",
          },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": {
            opacity: "0",
            transform: "translateY(20px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        spin: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        pulse: "pulse 2s infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        spin: "spin 1s linear infinite",
      },
      boxShadow: {
        "ride-card": "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
        "sos-button": "0 4px 12px rgba(220, 38, 38, 0.4)",
        "sos-button-hover": "0 6px 16px rgba(220, 38, 38, 0.6)",
      },
      spacing: {
        "18": "4.5rem",
        "88": "22rem",
      },
      maxWidth: {
        "mobile": "430px",
      },
      screens: {
        "mobile": "430px",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"), 
    require("@tailwindcss/typography"),
    // Custom plugin for ride-sharing specific utilities
    function({ addUtilities }: any) {
      addUtilities({
        '.mobile-container': {
          'max-width': '430px',
          'margin': '0 auto',
          'min-height': '100vh',
          'background': 'var(--background)',
          'box-shadow': '0 0 20px rgba(0,0,0,0.1)',
        },
        '.bottom-nav': {
          'position': 'fixed',
          'bottom': '0',
          'left': '50%',
          'transform': 'translateX(-50%)',
          'max-width': '430px',
          'width': '100%',
          'background': 'var(--card)',
          'border-top': '1px solid var(--border)',
          'z-index': '50',
        },
        '.driver-dot': {
          'position': 'absolute',
          'width': '40px',
          'height': '40px',
          'background': 'var(--secondary)',
          'border': '3px solid white',
          'border-radius': '50%',
          'display': 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'color': 'white',
          'font-size': '16px',
          'box-shadow': '0 2px 8px rgba(0,0,0,0.3)',
          'animation': 'pulse 2s infinite',
        },
        '.glass-effect': {
          'backdrop-filter': 'blur(10px)',
          'background': 'rgba(255, 255, 255, 0.1)',
          'border': '1px solid rgba(255, 255, 255, 0.2)',
        },
        '.gradient-bg-primary': {
          'background': 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
        },
        '.gradient-bg-accent': {
          'background': 'linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%)',
        },
      });
    },
  ],
} satisfies Config;

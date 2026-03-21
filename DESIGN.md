# Design System Specification: The Architectural Workspace



## 1. Overview & Creative North Star

**Creative North Star: The Silent Partner**

This design system moves beyond "minimalism" into the realm of **Architectural Clarity**. It is designed for high-stakes desktop productivity where the interface must recede to let the user’s data lead. We reject the "standard" SaaS aesthetic of heavy borders and bright gradients. Instead, we embrace an editorial approach: intentional white space, sophisticated tonal layering, and a rigid adherence to typography as the primary structural element.



The goal is to create a sense of **Ambient Authority**. The interface should feel like a well-organized physical desk—composed of layered surfaces, clear sightlines, and a tactile sense of depth that guides the eye without shouting for attention.



---



## 2. Colors & Surface Philosophy

We utilize a sophisticated palette of muted grays and low-saturation blues to maintain a "Cool/Neutral" temperature, reducing cognitive fatigue during long work sessions.



### The "No-Line" Rule

**Standard 1px borders are strictly prohibited for sectioning.** To create a high-end, custom feel, boundaries must be defined through background shifts.

* **The Technique:** Use `surface-container-low` for your base workspace and `surface-container-lowest` (#ffffff) for active content areas. The transition in hex code is enough to define the edge.

* **Exception:** If a physical boundary is required for accessibility, use a **Ghost Border**: the `outline-variant` token at 15% opacity.



### Surface Hierarchy & Nesting

Treat the UI as a series of nested physical layers.

* **Level 0 (Base):** `surface` (#f8f9fa) – Used for the global background.

* **Level 1 (Sub-navigation/Sidebars):** `surface-container` (#eaeff1) – Creates a slight recession.

* **Level 2 (Main Canvas):** `surface-container-low` (#f1f4f6) – The primary staging area.

* **Level 3 (Active Cards/Modals):** `surface-container-lowest` (#ffffff) – Pops forward as the most important layer.



### Glass & Texture

To move away from a "flat" feel, floating elements (menus, popovers) should use **Glassmorphism**:

* **Fill:** `surface_container_lowest` at 85% opacity.

* **Effect:** 12px – 20px Backdrop Blur.

* **CTA Soul:** For primary actions, use a subtle vertical gradient from `primary` (#496177) to `primary_dim` (#3d556a). This adds a "weighted" feel to buttons that solid colors cannot replicate.



---



## 3. Typography: The Editorial Engine

Typography is our primary architectural tool. We use a pairing of **Manrope** for structural headings and **Inter** for data density.



* **Display & Headlines (Manrope):** Large, bold, and authoritative. Use `display-md` or `headline-lg` to anchor a page. The wider apertures of Manrope provide an expensive, modern feel.

* **Body & Labels (Inter):** Specifically chosen for its high x-height and legibility in data-heavy tables.

* **The Hierarchy Rule:** Never use two different sizes of Inter to define hierarchy if you can use one size with a weight change (Medium vs. Regular) and a color shift (using `on_surface_variant` for secondary data).



| Role | Font | Size | Use Case |

| :--- | :--- | :--- | :--- |

| **Headline-LG** | Manrope | 2.0rem | Primary Page Title |

| **Title-MD** | Inter | 1.125rem | Section Headers / Table Groups |

| **Body-MD** | Inter | 0.875rem | Standard Data / Form Inputs |

| **Label-SM** | Inter | 0.6875rem | Metadata / Micro-copy |



---



## 4. Elevation & Depth

In this system, depth is achieved through **Tonal Layering** and **Ambient Light**, not drop shadows.



* **The Layering Principle:** Place a `surface-container-lowest` card on top of a `surface-container-low` section. The contrast (White on Soft Gray) creates a natural lift.

* **Ambient Shadows:** For floating elements (Modals/Dropdowns), use a multi-layered shadow:

* *Shadow 1:* 0px 4px 20px 0px (on-surface @ 4% opacity)

* *Shadow 2:* 0px 8px 40px 0px (on-surface @ 6% opacity)

* **Interaction Depth:** When a user hovers over a card, do not increase the shadow. Instead, shift the background color from `surface-container-low` to `surface-bright`.



---



## 5. Components



### Buttons

* **Primary:** Gradient fill (`primary` to `primary_dim`), white text, `md` (0.375rem) corner radius.

* **Secondary:** Ghost style. No fill, `outline-variant` Ghost Border (20% opacity).

* **Tertiary:** No border, no fill. Text uses `primary` color. Only for low-emphasis actions.



### Data Tables (The Core Productivity Tool)

* **Strict Rule:** No vertical or horizontal dividers.

* **Structure:** Use `spacing.4` (0.9rem) for row padding. Separate rows using a subtle hover state shift to `surface-container-high`.

* **Alignment:** Numeric data must be tabular-lining and right-aligned for instant scanning.



### Input Fields

* **Style:** Minimalist. Underline-only or a subtle `surface-container-highest` background.

* **Active State:** Use a 2px bottom border of `primary` (#496177). Avoid "glowing" focus rings; use a sharp, 1px inset of `primary_fixed` instead.



### Chips & Badges

* **Semantic Chips:** Use high-transparency backgrounds. For an Error state, `error_container` at 30% opacity with `on_error_container` text. This ensures the "Operational Safety" colors are present but not distracting.



---



## 6. Do's and Don'ts



### Do:

* **Use intentional asymmetry:** In a dashboard, allow the left sidebar and right content area to have vastly different widths and weights to create a sense of custom "editorial" layout.

* **Respect the Spacing Scale:** Stick strictly to the `0.2rem` increments. If an element feels "tight," jump two steps up the scale (e.g., from `spacing.4` to `spacing.6`).

* **Prioritize Typography:** If a layout feels messy, remove a box or a background and try to solve the hierarchy using only font weight and `on_surface_variant` color.



---

## 7. Product Architecture Patterns

This system is not intended for generic SaaS dashboards or module-heavy enterprise tools. It is designed for a **single-session desktop workbench** where conversation drives action and structured state remains continuously visible.




### Don't:

* **Don't use 100% Black:** Never use #000000. Use `on_background` (#2b3437) for text to maintain the "Calm/Professional" tone.

* **Don't use Rounded Corners for everything:** While we have a scale, keep larger containers at `md` (0.375rem) to maintain a "structured" and "architectural" feel. Avoid `full` (pill) shapes unless it's a small utility chip.

* **Don't use dividers:** If you feel the need to add a line, add `spacing.8` (1.75rem) of white space instead. If that fails, change the background color of the section.
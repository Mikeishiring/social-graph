# Design Bible - Social Graph Visual Style

## Overview

The Social Graph visualization follows a **clean, minimal, neural-network aesthetic** inspired by organic growth patterns. The design emphasizes clarity, elegance, and the feeling of watching a living network evolve.

---

## Core Principles

1. **Organic Growth** - The graph should feel like it "grew" naturally, not like a rigid data visualization
2. **Minimalism** - Less is more; whitespace is a feature
3. **Hierarchy Through Size** - Important nodes are dramatically larger
4. **Subtle Connections** - Edges fade into the background; nodes are the focus
5. **Avatar-Centric** - People (avatars) are the primary visual element

---

## Color Palette

### Background
| Element | Color | Usage |
|---------|-------|-------|
| Canvas BG | `#f8fafc` | Primary background (slate-50) |
| Subtle gradient | `#f1f5f9` → `#ffffff` | Soft depth |

### Nodes
| Element | Color | Usage |
|---------|-------|-------|
| Avatar ring | `#ffffff` | Clean white border around avatars |
| Avatar ring shadow | `rgba(0,0,0,0.08)` | Subtle depth |
| Small node fill | `#94a3b8` | Muted gray for non-avatar nodes (slate-400) |
| Small node stroke | `#cbd5e1` | Lighter border (slate-300) |

### Edges
| Element | Color | Opacity | Usage |
|---------|-------|---------|-------|
| Default edge | `#cbd5e1` | 0.4 | Standard connections (slate-300) |
| Hover/selected edge | `#94a3b8` | 0.6 | Highlighted connections |

### UI Elements
| Element | Color | Usage |
|---------|-------|-------|
| Panel BG | `rgba(255,255,255,0.95)` | Frosted glass panels |
| Panel border | `rgba(0,0,0,0.06)` | Subtle borders |
| Text primary | `#1e293b` | Main text (slate-800) |
| Text secondary | `#64748b` | Muted text (slate-500) |
| Accent | `#3b82f6` | Interactive elements (blue-500) |

---

## Node Styling

### Size Hierarchy (Critical)

Nodes have THREE visual tiers based on importance:

| Tier | Size Range | Visual Treatment |
|------|------------|------------------|
| **Hub Nodes** (top 5%) | 24-40px | Avatar photo with white ring + shadow |
| **Notable Nodes** (top 25%) | 12-20px | Avatar photo with thin white ring |
| **Background Nodes** (rest) | 4-8px | Simple filled circle, no avatar |

### Avatar Nodes
```
┌─────────────────────┐
│   ╭───────────╮     │
│   │  AVATAR   │     │  White ring: 3px
│   │   PHOTO   │     │  Shadow: 0 2px 8px rgba(0,0,0,0.12)
│   ╰───────────╯     │
└─────────────────────┘
```

- Circle-cropped avatar image
- Clean white border (2-4px depending on size)
- Subtle drop shadow
- No colored backgrounds or glows

### Small Nodes (Non-Avatar)
```
    ●  ← Simple filled circle
```

- Solid fill: `#94a3b8` (slate-400)
- No border or minimal `#cbd5e1` border
- Size: 4-8px diameter
- These create the "neural dust" background texture

---

## Edge Styling

### Visual Properties

| Property | Value |
|----------|-------|
| Stroke width | 1px (uniform) |
| Color | `#cbd5e1` (slate-300) |
| Opacity | 0.3-0.5 |
| Style | Straight lines (no curves) |
| Caps | Round |

### Behavior

- **Default state**: Very subtle, almost fade into background
- **Hover on node**: Connected edges become slightly more visible (0.6 opacity)
- **Selected node**: Connected edges highlight to `#94a3b8` at 0.7 opacity
- **No edge labels** - ever

### Anti-Patterns (Do NOT)
- Colored edges based on type
- Varying thickness
- Animated edges
- Edge labels or decorations
- Glow effects

---

## Layout & Spacing

### Organic Distribution

The layout should feel like:
- A neural network or brain scan
- Clusters of activity connected by thin strands
- Natural spacing with breathing room

### Cluster Behavior

- Hub nodes sit at cluster centers
- Smaller nodes orbit around hubs
- Strands connect clusters through "bridge" nodes
- Empty space between clusters is intentional

### Camera & View

| Property | Value |
|----------|-------|
| Default distance | Show ~80% of graph |
| Auto-rotation | Slow, continuous (0.001 rad/frame) |
| Damping | High (0.05) for smooth stops |
| Zoom range | 0.5x to 3x default |

---

## Animation & Motion

### Guiding Principle
**Slow, organic, calming** - like watching cells under a microscope

### Auto-Rotation
- Speed: ~6 degrees per second
- Smooth, continuous
- Pauses on interaction
- Resumes after 3s idle

### Node Hover
- Subtle scale: 1.0 → 1.1 (ease-out, 200ms)
- No color change
- Connected edges fade in slightly

### Timeline Playback
- New nodes fade in (opacity 0 → 1, 400ms)
- Position interpolation is smooth (lerp factor 0.08)
- No "popping" or teleporting

---

## Typography

### Font Stack
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Panel Text

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Panel title | 11px | 500 | `#64748b` (slate-500) |
| Handle/name | 14px | 500 | `#1e293b` (slate-800) |
| Stats/numbers | 13px | 400 | `#334155` (slate-700) |
| Labels | 11px | 400 | `#64748b` (slate-500) |

### Node Labels (Floating)
- Only show for top ~10 nodes by importance
- Small, unobtrusive
- Background: `rgba(255,255,255,0.9)`
- Border: `1px solid rgba(0,0,0,0.08)`
- Font: 11px, medium weight
- Position: Above node with 8px gap

---

## UI Panels

### Visual Treatment
```
╭────────────────────────────╮
│  PANEL TITLE               │  ← Uppercase, letter-spaced
├────────────────────────────┤
│                            │
│  Content area              │  ← Regular case
│                            │
╰────────────────────────────╯
```

### Properties
| Property | Value |
|----------|-------|
| Background | `rgba(255,255,255,0.92)` |
| Backdrop blur | 12px |
| Border | `1px solid rgba(0,0,0,0.06)` |
| Border radius | 12px |
| Shadow | `0 4px 20px rgba(0,0,0,0.06)` |
| Padding | 16-20px |

---

## Interaction States

### Node Hover
- Cursor: pointer
- Scale: 1.1x
- Tooltip appears after 200ms delay
- Connected nodes: no change
- Connected edges: slight opacity increase

### Node Selected
- Scale: 1.15x (subtle)
- Ring highlight: 2px white with shadow
- Connected nodes: normal opacity
- Non-connected nodes: 0.3 opacity
- Connected edges: 0.7 opacity
- Non-connected edges: hidden

### Background Click
- Deselect current node
- Fade all nodes back to normal
- Show all edges at default opacity

---

## Responsive Behavior

### Performance Tiers

| Node Count | Avatar Nodes | Label Count | Edge Opacity |
|------------|--------------|-------------|--------------|
| < 100 | Top 30% | 15 | 0.4 |
| 100-300 | Top 20% | 10 | 0.35 |
| 300-600 | Top 10% | 6 | 0.3 |
| > 600 | Top 5% | 0 | 0.25 |

### LOD (Level of Detail)

When zoomed out:
- Hide node labels
- Reduce avatar nodes to simple circles
- Fade edges further

When zoomed in:
- Show more labels
- Render avatar detail
- Edges slightly more visible

---

## Do's and Don'ts

### DO
- Keep it clean and minimal
- Use whitespace generously
- Make avatars the focal point
- Keep edges subtle and understated
- Animate slowly and smoothly
- Let the network "breathe"

### DON'T
- Add colored edges
- Use glows or particle effects
- Animate aggressively
- Clutter with labels
- Make edges prominent
- Use dark themes
- Add decorative elements

---

## Reference Aesthetic

The visual style draws from:
- Neural network visualizations
- Constellation maps
- Social network graphs (LinkedIn connections view)
- Minimalist data visualization (Observable, Flourish)

The feeling should be:
- Professional and polished
- Calm and contemplative
- Scientific yet approachable
- Like watching life evolve

---

*Last updated: 2026-01-23*

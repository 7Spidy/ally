# Ally logo: five Nano Banana prompts

## Read this before you generate

Nano Banana is a strong image model and a poor logo tool. It cannot reliably render letterforms, it will not give you clean vector edges, and it has no concept of a grid or optical balance. Expect it to produce a **direction**, not an asset.

The workflow that actually works:

1. Run each prompt three or four times. You are fishing for one good idea per concept, not a finished mark.
2. Pick two or three that hold up at thumbnail size. Squint at them. If the shape survives squinting, it works.
3. Redraw the winner as SVG by hand or hand it to a designer. The generated image is reference, never the shipped file.
4. Concepts 1 to 4 are symbol-only, which is where the model is strongest. Concept 5 is a wordmark, which is where it is weakest. Judge it on the shape of the idea and expect the letters to be mangled.

Every prompt below already specifies flat vector rendering, a plain background, and a single colour. Those constraints are what keep the output usable as reference rather than as a glossy render.

---

## Concept 1: The lean

Two forms leaning into each other. Companionship without drawing a single human being.

```
A minimalist flat vector logo symbol. Two simple geometric forms lean
inward and rest against each other at the top, forming an implied letter
A without any letterform being drawn. Left form is a solid warm cream
shape, right form is the same shape mirrored. Where they touch there is
a small deliberate gap of negative space, not a join. Clean geometric
construction, uniform stroke weight, sharp terminals, no gradients, no
shadows, no 3D, no bevel, no glow. Flat single-colour mark, warm cream
#F4EFE6 on a solid deep near-black #0A0910 background. Centred, generous
margin, symbol occupies about 55 percent of the frame. Swiss modernist
logo design, the kind of mark that still reads at 16 pixels. No text, no
letters, no words, no typography anywhere in the image.
```

**What to look for:** the gap. If the two forms merge into one blob the idea is dead. The gap is the whole point, because two things that touch but stay separate is a more honest picture of this product than two things that fuse.

---

## Concept 2: The listening mark

A quotation mark that resolves into a face in profile. Speech and person in one shape.

```
A minimalist flat vector logo symbol. A single opening quotation mark
made of two soft comma shapes, arranged so that the outer silhouette
also reads as a human face in profile facing right. Dual reading is
essential: quotation mark at a glance, profile on second look. Smooth
continuous curves, generous counters, uniform optical weight, flat
single colour with no gradients, no shadows, no outline stroke, no 3D.
Warm cream #F4EFE6 on a solid deep near-black #0A0910 background.
Centred composition, symbol occupies about 50 percent of the frame,
large clear margin. Refined contemporary logo design in the manner of a
Pentagram identity. No text, no letters, no words, no typography.
```

**What to look for:** whether the second reading actually lands. Most attempts will give you a quotation mark that is not a face, or a face that is not a quotation mark. Discard both.

---

## Concept 3: The overlap

Two circles and the space they share. The oldest idea here, and the one most likely to produce something clean.

```
A minimalist flat vector logo symbol. Two identical circles overlap
horizontally by roughly one third of their width. The circles themselves
are drawn as thin outlines in muted warm grey; the lens-shaped
intersection where they overlap is filled solid in warm cream and is the
brightest element in the mark. The eye should go to the shared space,
not the circles. Precise geometric construction, mathematically even
overlap, flat colour only, no gradients, no shadows, no 3D, no texture.
Warm cream #F4EFE6 and muted grey #6F6880 on a solid deep near-black
#0A0910 background. Perfectly centred, symbol occupies about 45 percent
of the frame. Bauhaus geometric precision. No text, no letters, no
words, no typography.
```

**What to look for:** clean tangents and an even overlap. This concept lives or dies on precision, and it is the easiest of the five to redraw properly in SVG once you have the proportion right.

---

## Concept 4: The doorway

A single continuous stroke forming an arch that also reads as an A. Pulls a genuinely Indian architectural reference without a single cliché.

```
A minimalist flat vector logo symbol. One single continuous stroke of
even thickness traces a pointed arch, the profile of a Mughal doorway,
with a horizontal crossbar low in the opening so the whole shape also
reads as the letter A. The stroke never breaks and never varies in
width. Interior of the arch is empty negative space. Architectural,
structural, calm, a threshold rather than a decoration. No ornament, no
filigree, no jali pattern, no paisley, no mandala, no floral motif. Flat
single colour, no gradients, no shadows, no 3D, no perspective. Warm
cream #F4EFE6 on a solid deep near-black #0A0910 background. Centred,
symbol occupies about 55 percent of the frame, generous margin. Modern
architectural logo design. No text, no letters, no words, no typography
apart from the implied A formed by the stroke itself.
```

**What to look for:** restraint. The model badly wants to add ornament to anything it reads as Indian. The explicit no-list is doing real work and you should still expect to discard half the outputs for creeping decoration.

---

## Concept 5: The wordmark

Lowercase, warm serif, the two Ls standing side by side like two people. Expect the model to butcher the letters. Judge the idea.

```
A logotype for a brand called ally. The word is set in lowercase in a
warm high-contrast transitional serif with generous letter spacing:
a, l, l, y. The two adjacent lowercase l letters are the focal point,
standing side by side at identical height like two figures next to each
other, close but not touching, with slightly wider spacing between them
than elsewhere in the word so the pair reads as a deliberate detail. The
descender of the y is a single elegant unbroken curve. Warm cream
#F4EFE6 on a solid deep near-black #0A0910 background. Flat colour, no
gradient, no shadow, no 3D, no glow, no outline. Centred on a single
baseline, wordmark occupies about 65 percent of the frame width, large
clear margin above and below. Refined editorial typography, the register
of a literary imprint rather than a technology company. Only the four
letters a l l y and nothing else in the image.
```

**What to look for:** the spacing between the two Ls, and whether the y descender resolves cleanly. Ignore letterform quality entirely. If the idea reads, set it properly in Instrument Serif yourself, which is already the product's display face and will look better than anything generated.

---

## Variants worth trying on whichever concept wins

Append one of these to the chosen prompt:

- `Render as a solid mark reversed out: deep near-black symbol on a warm cream #F4EFE6 background.` Tests whether it works on light.
- `Render the symbol at four sizes in one image, from very large to very small, to test legibility at small scale.` The cheapest legibility check you will get.
- `Render the symbol enclosed in a rounded square app icon with 22 percent corner radius, symbol occupying 60 percent of the tile.` Tests app icon behaviour before committing.

## Prompt hygiene

- Always include `no text, no letters, no words, no typography` on concepts 1 to 4. Without it the model adds a caption in a nonexistent language roughly half the time.
- Always name the hex codes. Colour words alone drift.
- Always say `flat, no gradients, no shadows, no 3D`. The default aesthetic is a glossy render and it is useless for a mark.
- Never say `modern`, `sleek`, `innovative`, `cutting-edge` or `AI`. Those words pull toward hexagons, neural-network motifs and glowing orbs. Every one of those is a dead end for this brand.

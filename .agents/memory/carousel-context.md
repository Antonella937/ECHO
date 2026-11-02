---
name: Carousel context
description: User's intended meaning of carousels and future visual context for character reactions.
---

A “carrete” is several photos in one publication. The future AI Engine must be able to distinguish “foto 1, foto 2…” and react to any individual photo/video while considering the publication as a whole. Looking only at the cover is insufficient.

**Why:** The user explicitly wants “que los otros personajes que viven dentro de Eco, que puedan analizar las fotos”, including any element of a multi-photo publication, not just its first image.

**How to apply:** When implementing visual context later, preserve item identity and order and include the shared caption/context. Do not treat carousel infrastructure as evidence that visual analysis or video processing is already connected.

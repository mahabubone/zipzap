import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** Frontmatter every doc page carries, whatever catalog it belongs to. */
const docSchema = z.object({
  /**
   * The page's title, and the label in any nav that lists it. Required rather than derived from
   * the filename: a filename is a slug constraint, not a title, and `getting-started.md` titled
   * "Getting started" is a coincidence that stops being true the first time someone adds
   * `getting-started-fast.md`.
   */
  title: z.string().min(1),
  /** One line, shown under the title in a listing and as the meta description. */
  description: z.string().min(1),
  /**
   * Rough reading order within a catalog. Not a sort key on its own — pages without an order sort
   * by title, so adding a numbered page does not silently reorder the unnumbered ones.
   */
  order: z.number().int().optional(),
  /**
   * Who the page is for. Rendered as a tag on the tile and used to filter, because a rider reading
   * the merchant onboarding guide is a support ticket not yet filed.
   */
  audience: z.enum(['merchant', 'rider', 'hub', 'operator', 'developer', 'all']).default('all'),
});

/**
 * The prose catalogs.
 *
 * Each is a directory of markdown, because a catalog is a folder in `src/content/` and the URL
 * structure is `/<collection>/<slug>`. Slug comes from the filename, so `01-sign-up.md` becomes
 * `/merchant-onboarding/01-sign-up` — which is why the numbering is in the filename rather than a
 * frontmatter field: filesystem order is the nav order.
 */
const catalogs = ['onboarding', 'rider', 'hub', 'operations', 'faq'] as const;

export const collections = Object.fromEntries(
  catalogs.map((name) => [
    name,
    defineCollection({
      loader: glob({ pattern: '*.md', base: `./src/content/${name}` }),
      schema: docSchema,
    }),
  ]),
);

const CMS_URL = (process.env.NEXT_PUBLIC_CMS_API_URL || "https://cms-api.masterstroke.academy").replace(/\/+$/, "");
const SITE_TOKEN = process.env.NEXT_PUBLIC_CMS_SITE_TOKEN || "site_token_demo_mst_academy_1785489667016";

export interface FAQItem {
  question: string;
  answer: string;
}

export interface BlogPost {
  _id?: string;
  id?: string;
  slug: string;
  title?: string;
  heading?: string;
  metaTitle?: string;
  description?: string;
  subHeading?: string;
  metaDescription?: string;
  excerpt?: string;
  content?: string;
  body?: string;
  html?: string;
  coverImage?: string;
  image?: string;
  featuredImage?: string;
  cardImage?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  canonical?: string;
  primaryKeyword?: string;
  supportKeywords?: string[];
  articleSection?: string;
  inLanguage?: string;
  author?: string | { name?: string; avatar?: string; bio?: string; url?: string };
  category?: string;
  tags?: string[];
  keywords?: string[];
  createdAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  modifiedAt?: string;
  readTime?: string | number;
  faqs?: FAQItem[];
}

export const FEATURED_BLOGS: BlogPost[] = [];

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  if (!slug) return null;

  try {
    const url = `${CMS_URL}/api/v1/connector/posts/${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-site-token": SITE_TOKEN,
        "Content-Type": "application/json",
      },
      next: { revalidate: 60 },
    });

    if (response.ok) {
      const data = await response.json();
      if (data) {
        const post: BlogPost = data.data || data.post || data;
        if (post && (post.title || post.heading || post.slug)) {
          return post;
        }
      }
    }
  } catch (error: any) {
    console.warn("CMS API fetch failed:", error?.message || error);
  }

  return null;
}

export async function getAllPosts(limit?: number): Promise<BlogPost[]> {
  try {
    const url = new URL(`${CMS_URL}/api/v1/connector/posts`);
    if (limit) url.searchParams.set("limit", limit.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-site-token": SITE_TOKEN,
        "Content-Type": "application/json",
      },
      next: { revalidate: 60 },
    });

    if (response.ok) {
      const data = await response.json();
      if (data) {
        const posts = Array.isArray(data) ? data : data.data || data.posts || [];
        if (Array.isArray(posts)) {
          return limit ? posts.slice(0, limit) : posts;
        }
      }
    }
  } catch (error: any) {
    console.warn("CMS API list fetch failed:", error?.message || error);
  }

  return [];
}

export function generateBlogSchemas(post: BlogPost, slug: string) {
  const headline = post.heading || post.title || post.metaTitle || "Blog Post";
  const description =
    post.metaDescription || post.subHeading || post.excerpt || post.description || "";
  const datePublished = post.publishedAt || post.createdAt || "2026-08-01";
  const dateModified = post.modifiedAt || post.updatedAt || datePublished;
  const image =
    post.ogImage ||
    post.coverImage ||
    post.image ||
    post.featuredImage ||
    post.cardImage ||
    `https://masterstroke.academy/api/og?title=${encodeURIComponent(headline)}`;
  const absoluteImage = image.startsWith("http") ? image : `https://masterstroke.academy${image}`;

  const authorName =
    typeof post.author === "string"
      ? post.author
      : post.author?.name || "Masterstroke Academy";
  const authorUrl =
    typeof post.author === "object" && post.author?.url
      ? post.author.url
      : "https://masterstroke.academy";

  const articleKeywords = post.keywords || [
    ...(post.primaryKeyword ? [post.primaryKeyword] : []),
    ...(post.supportKeywords || []),
  ];

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: headline,
    description: description,
    image: absoluteImage,
    author: {
      "@type": "Organization",
      name: authorName,
      url: authorUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "Masterstroke Academy",
      logo: {
        "@type": "ImageObject",
        url: "https://masterstroke.academy/Acadmy Logo.png",
      },
    },
    datePublished: datePublished,
    dateModified: dateModified,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": post.canonical || `https://masterstroke.academy/blogs/${slug}`,
    },
    articleSection: post.articleSection || post.category || "Blockchain Development",
    keywords: articleKeywords,
    inLanguage: post.inLanguage || "en-IN",
  };

  const faqSchema =
    post.faqs && post.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: faq.answer,
            },
          })),
        }
      : null;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://masterstroke.academy/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blogs",
        item: "https://masterstroke.academy/blogs",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: headline,
        item: post.canonical || `https://masterstroke.academy/blogs/${slug}`,
      },
    ],
  };

  return { articleSchema, faqSchema, breadcrumbSchema };
}

// Backward compatibility helper
export function generateArticleSchema(post: BlogPost, slug: string) {
  return generateBlogSchemas(post, slug).articleSchema;
}

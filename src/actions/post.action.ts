"use server";

import { prisma } from "@/lib/prisma";
import { getDbUserId } from "./user.action";
import { revalidatePath } from "next/cache";

export async function createPost(content: string, image: string) {
  try {
    const userId = await getDbUserId();

    if (!userId) return;

    const post = await prisma.post.create({
      data: {
        content,
        image,
        authorID: userId,
      },
    });

    revalidatePath("/"); // purge the cache for the home page
    return { success: true, post };
  } catch (error) {
    console.error("Failed to create post:", error);
    return { success: false, error: "Failed to create post" };
  }
}

export async function getPosts() {
  try {
    const posts = await prisma.post.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
            username: true,
          },
        },
        comments: {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                image: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        likes: {
          select: {
            userID: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    return posts;
  } catch (error) {
    console.log("Error in getPosts", error);
    throw new Error("Failed to fetch posts");
  }
}

export async function toggleLike(postID: string) {
    try {
      const userID = await getDbUserId();
      if (!userID) return;
  
      // check if like exists
      const existingLike = await prisma.like.findUnique({
        where: {
          userID_postID: {
            userID,
            postID,
          },
        },
      });
  
      const post = await prisma.post.findUnique({
        where: { id: postID },
        select: { authorID: true },
      });
  
      if (!post) throw new Error("Post not found");
  
      if (existingLike) {
        // unlike
        await prisma.like.delete({
          where: {
            userID_postID: {
              userID,
              postID,
            },
          },
        });
      } else {
        // like and create notification (only if liking someone else's post)
        await prisma.$transaction([
          prisma.like.create({
            data: {
              userID,
              postID,
            },
          }),
          ...(post.authorID !== userID
            ? [
                prisma.notifications.create({
                  data: {
                    type: "LIKE",
                    userID: post.authorID, // recipient (post author)
                    creatorID: userID, // person who liked
                    postID,
                  },
                }),
              ]
            : []),
        ]);
      }
  
      revalidatePath("/");
      return { success: true };
    } catch (error) {
      console.error("Failed to toggle like:", error);
      return { success: false, error: "Failed to toggle like" };
    }
  }

  export async function createComment(postID: string, content: string) {
    try {
      const userID = await getDbUserId();
  
      if (!userID) return;
      if (!content) throw new Error("Content is required");
  
      const post = await prisma.post.findUnique({
        where: { id: postID },
        select: { authorID: true },
      });
  
      if (!post) throw new Error("Post not found");
  
      // Create comment and notification in a transaction
      const [comment] = await prisma.$transaction(async (tx) => {
        // Create comment first
        const newComment = await tx.comment.create({
          data: {
            content,
            authorID: userID,
            postID,
          },
        });
  
        // Create notification if commenting on someone else's post
        if (post.authorID !== userID) {
          await tx.notifications.create({
            data: {
              type: "COMMENT",
              userID: post.authorID,
              creatorID: userID,
              postID,
              commentID: newComment.id,
            },
          });
        }
  
        return [newComment];
      });
  
      revalidatePath(`/`);
      return { success: true, comment };
    } catch (error) {
      console.error("Failed to create comment:", error);
      return { success: false, error: "Failed to create comment" };
    }
  }

  export async function deletePost(postID: string) {
    try {
      const userId = await getDbUserId();
  
      const post = await prisma.post.findUnique({
        where: { id: postID },
        select: { authorID: true },
      });
  
      if (!post) throw new Error("Post not found");
      if (post.authorID !== userId) throw new Error("Unauthorized - no delete permission");
  
      await prisma.post.delete({
        where: { id: postID },
      });
  
      revalidatePath("/"); // purge the cache
      return { success: true };
    } catch (error) {
      console.error("Failed to delete post:", error);
      return { success: false, error: "Failed to delete post" };
    }
  }
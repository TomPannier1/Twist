"use server";

import { prisma } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function syncUser() {
    try {
      const { userId } = await auth();
      const user = await currentUser();
  
      if (!userId || !user) return;
  
      const existingUser = await prisma.user.findUnique({
        where: {
          clerkId: userId,
        },
      });
  
      if (existingUser) return existingUser;
  
      const dbUser = await prisma.user.create({
        data: {
          clerkId: userId,
          name: `${user.firstName || ""} ${user.lastName || ""}`,
          username: user.username ?? user.emailAddresses[0].emailAddress.split("@")[0],
          email: user.emailAddresses[0].emailAddress,
          image: user.imageUrl,
        },
      });
  
      return dbUser;
    } catch (error) {
      console.log("Error in syncUser", error);
    }
  }

export async function getUserByClerkID(clerkId:string) {
    return await prisma.user.findUnique({
        where: {
            clerkId,
        },
        include: {
          _count: {
            select: { followers: true, following: true, posts: true },
          }
        }
    })

}

export async function getDbUserId() {
  const {userId:clerkId}= await auth();
  if (!clerkId) return null;
  const user = await getUserByClerkID(clerkId);
  if (!user) throw new Error ("User not found");
  return user.id;
}

export async function getRandomUser() {
  try {
    const userId = await getDbUserId();

    if (!userId) return [];
    //Get 3 random users excluding ourselves and users we are already following
    const randomUsers = await prisma.user.findMany({
      where: {
        AND: [
          {NOT : {id: userId}},
          {NOT : {followers: {some: {followerID: userId}}}},
        ] 
      },
      select: {
        id:true,
        name:true,
        username:true,
        image:true,
        _count: {select: {followers:true}},
      },
    take: 3,
    });
    return randomUsers;

  } catch (error) {
    console.log("Error fetching random users",error);
    return[];
  }
}

export async function toggleFollow(targetUserId: string) {
  try {
    const userId = await getDbUserId();
    if(!userId) return;
    if (userId === targetUserId) throw new Error("Cannot follow yourself");
    const existingFollow = await prisma.follows.findUnique({
      where: {
        followerID_followingID: {
          followerID: userId,
          followingID: targetUserId,
        }
      },
    });

    if (existingFollow) {
      await prisma.follows.delete({
        where: {
          followerID_followingID: {
            followerID: userId,
            followingID: targetUserId,
          }
        }
      });
    } else {
      await prisma.$transaction([
        prisma.follows.create({
          data: {
            followerID: userId,
            followingID: targetUserId,
          }
        }),
        prisma.notifications.create({
          data: {
            type: "FOLLOW",
            userID: targetUserId,
            creatorID: userId,
          }
        })
      ])
    }
    revalidatePath("/");
    return{success:true};
  } catch (error) {
    console.log("Error in toggleFollow",error);
    return{success:false,error:"Failed to follow user"};
  }
}
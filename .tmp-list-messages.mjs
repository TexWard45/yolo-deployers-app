import { prisma } from './packages/database/src/index.ts';

async function main() {
  const run = await prisma.threadAnalysis.findUnique({
    where: { id: 'cmn0mbyy100234bm1img3vn8w' },
    select: {
      threadId: true,
      summary: true,
      thread: {
        select: {
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { direction: true, body: true, createdAt: true },
          },
        },
      },
    },
  });

  console.log('summary', run?.summary);
  for (const msg of run?.thread.messages ?? []) {
    console.log(msg.direction, msg.createdAt.toISOString(), msg.body?.slice(0,120));
  }
}

main().catch((error)=>{ console.error(error); process.exitCode = 1;});

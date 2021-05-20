import Bull from "bull"
import { updateDeviceDetails } from "./ActivitySchedulerJob"
import { Mutex } from "async-mutex"
import LAMP from "lamp-core"
const clientLock = new Mutex()

/**
 *
 * @param job
 * @param done
 */
export async function SchedulerDeviceUpdateQueueProcess(job: Bull.Job<any>, done: Bull.DoneCallback): Promise<void> {
  const release = await clientLock.acquire()
  console.log(`locked job on ${job.data.participant_id}`)

  const activityIDs: any = []
  try {
    const parent = await LAMP.Type.parent(job.data.participant_id)
    const study_id = parent?.data.Study    
    const activities: any = await LAMP.Activity.allByStudy(study_id, undefined, true)

    // Process activities to find activity_id
    if (activities.length != 0) {
      for (const activity of activities) {
        // If the activity has no schedules, ignore it.
        if (activity.schedule === undefined || activity.schedule.length === 0) continue
        await activityIDs.push(activity.id)
      }
      await updateDeviceDetails(activityIDs, job.data)
    }
    //release the lock for thread
    release()
    console.log(`release lock  on success  ${job.data.participant_id}`)
  } catch (error) {
    //release the lock for thread
    release()
    console.log(`release lock  on exception  ${job.data.participant_id}`)
  }
  done()
  console.log(`Job completed -  ${job.data.participant_id}`)
}

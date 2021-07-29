import Bull from "bull"
import { SchedulerQueueProcess, SchedulerQueueOnCompleted } from "./SchedulerQueue"
import { UpdateToSchedulerQueueProcess } from "./UpdateToSchedulerQueue"
import { SchedulerDeviceUpdateQueueProcess } from "./SchedulerDeviceUpdateQueue"
import { DeleteFromSchedulerQueueProcess } from "./DeleteFromSchedulerQueue"

export let SchedulerQueue: Bull.Queue<any> | undefined
export let SchedulerReferenceQueue: Bull.Queue<any> | undefined
export let UpdateToSchedulerQueue: Bull.Queue<any> | undefined
export let SchedulerDeviceUpdateQueue: Bull.Queue<any> | undefined
export let DeleteFromSchedulerQueue: Bull.Queue<any> | undefined

/**Initialize queues and its process
 *
 */
export async function initializeQueues(): Promise<void> {
  try {
    console.log("initialize queue")
    SchedulerQueue = new Bull("Scheduler", process.env.REDIS_HOST ?? "")
    SchedulerReferenceQueue = new Bull("SchedulerReference", process.env.REDIS_HOST ?? "")
    UpdateToSchedulerQueue = new Bull("UpdateToScheduler", process.env.REDIS_HOST ?? "")
    SchedulerDeviceUpdateQueue = new Bull("SchedulerDeviceUpdate", process.env.REDIS_HOST ?? "")
    DeleteFromSchedulerQueue = new Bull("DeleteFromScheduler", process.env.REDIS_HOST ?? "")

    SchedulerQueue.process((job, done) => {
      SchedulerQueueProcess(job, done)
    })
    SchedulerQueue.on("completed", (job) => {
      SchedulerQueueOnCompleted(job)
    })
    UpdateToSchedulerQueue.process((job, done) => {
      UpdateToSchedulerQueueProcess(job, done)
    })
    SchedulerDeviceUpdateQueue.process((job, done) => {
      SchedulerDeviceUpdateQueueProcess(job, done)
    })
    DeleteFromSchedulerQueue.process((job, done) => {
      DeleteFromSchedulerQueueProcess(job, done)
    })
  } catch (error) {
    console.log("initialize queue",error)
  }
}

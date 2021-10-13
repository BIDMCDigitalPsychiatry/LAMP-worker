import LAMP from "lamp-core"
import { triggers } from "../app"
import { ScriptRunner } from "../helpers/ScriptRunner"

/**find automation script for researcher
 *
 * @param researcher_id
 */
export async function LocateAutomation(researcher_id: string) {
  let automations: any = {}
  try {
    automations = await LAMP.Type.getAttachment(researcher_id, "lamp.automation")
  } catch (error) {}
  const automation_script = automations?.data
  if (!!automation_script) {
    const trigger_group = await automation_script.split("trigger=")[1]
    const triggers_ = (await trigger_group.split(";base64")[0].split("&")) as any
    if (triggers_.length) {      
      for (const trigger of triggers_) {
        try {          
          if (!!triggers[trigger]) {
            if (!triggers[trigger].includes(researcher_id)) await triggers[trigger].push(researcher_id)
          } else {
            triggers[trigger] = [researcher_id]
          }
        } catch (error) {}
      }
    }
  } 
  console.log("trigger dictionary storing automations", triggers) 
}

/** store automations for reesearcher id published from lamp-server
 *
 * @param topic
 * @param data
 */
export const StoreAutomations = (topic: string, data: any) => {
  try {
    const data_ = JSON.parse(data) ?? undefined
    if (!!data_ && topic === "lamp.automation") {
      LocateAutomation(data_.researcher_id)
    }
  } catch (error) {}  
}

/** trigger automation script
 *
 * @param token
 * @param data
 */
export const TriggerAutomations = async (token: string, data: any) => {
  const data_ = JSON.parse(data) ?? undefined
  const related_tokens = await getRelatedTokens(token)
  for (const related_token of related_tokens) {
    if (!!triggers[related_token]) {
      const researchers = triggers[related_token]
      for (const researcher of researchers) {
        try {
          const automations = (await LAMP.Type.getAttachment(researcher, "lamp.automation")) as any
          console.log(`Automation found for researcher - ${researcher} with token-${related_token}`)
          const automation_script = automations?.data ?? undefined
          if (!!automation_script) {
            const script: string = await automation_script.split(";base64,")[1]
            const language: string = await automation_script.split("language=")[1].split(";")[0]
            const driverscript: string = automation_script?.split("driverscript=")[1].split(";")[0]??undefined
            let runner: ScriptRunner
            switch (language) {
              case "js":
                runner = new ScriptRunner.JS()
                runner.execute(script, driverscript, related_token, JSON.stringify(data))
                break
              case "py":
                runner = new ScriptRunner.PY()
                runner.execute(script, driverscript, related_token, JSON.stringify(data))
                break

              default:
                break
            }
          }
        } catch (error) {}
      }
    } else continue
  }
}

/**Get related tokens(eg: a.id1.b.aid1 will gives a.*.b.aid1,a.id1.b.*,a.*.b.* )
 *
 * @param token
 * @returns ARRAY related_tokens
 */
const getRelatedTokens = async (token: string): Promise<string[]> => {
  try {
    let related_tokens: string[] = []
    const arr = token.split(".")
    if (arr.length === 2) {
      related_tokens.push(arr[0] + ".*", token)
    } else if (arr.length === 4) {
      related_tokens.push(
        arr[0] + ".*" + "." + arr[2] + ".*",
        arr[0] + ".*." + arr[2] + "." + arr[3],
        arr[0] + "." + arr[1] + "." + arr[2] + ".*",
        token
      )
    }
    return related_tokens
  } catch (error) {
    console.log("token generation", error)
    return []
  }
}

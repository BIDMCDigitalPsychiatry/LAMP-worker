package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
)

//base url for the SSE server in this format http://localhost
var baseURL string
//couch DB server address
var couchURL string
//Addr ... consumer host:port for the server to run
var Addr string

//couch DB instance
var db *Cache


//starting point of the consumer
func main(){

	var err error
	baseURL = os.Getenv("SSE")
	couchURL = os.Getenv("CDB")
	Addr = os.Getenv("ADDR")

	if baseURL == ""{
		log.Printf("invalid SSE server address")
		return
	}
	if couchURL == ""{
		log.Printf("invalid couch DB URL address")
		return
	}
	if Addr == ""{
		log.Printf("invalid host:port for the server to run")
		return
	}
	//load the event listeners from the sseevents,json
	err = loadSSEEventListeners()
	if err != nil{
		log.Println("unable to load listeners.")
		return
	}
	
	db,err  = NewCache(couchURL)
	if err != nil{
		panic("error connecting to couch db:"+err.Error())
	}
	//check if the direcotry of scripts exists and if not create one
	_, err = os.Stat("./scripts")
    if os.IsNotExist(err) {
        os.Mkdir("./scripts",0755)
    }
	
	//get the fiber server instance
	app := fiber.New()

	//API to uplaod the JS sripts
	app.Post("/uploadJSScript",subscribeJSScript)

	//API to uplaod the python scripts
	app.Post("/uploadPYScript",subscribePYScript)

	//API to delete a script
	app.Delete("/unsubscribe",unsubscribeScript)

	//API to update a script
	app.Post("/updatesScript",updateScript)
	//this is just for testing and will be deleted before pushing to production
	app.Get("/showPath",showPath)

	//start listneing 
	log.Println("consumer listening on :",Addr)
	log.Println(app.Listen(Addr))

}
//sho the path fopr the token passed
func showPath(c *fiber.Ctx)error{
	token := c.Query("token")

	if token==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty token")
	}
	arr ,err := db.GetPaths(token)
	if err!=nil{
		return fiber.NewError(fiber.StatusInternalServerError,err.Error())
	}
	return c.JSON(arr)

}
//unsubscribeScript ... unsubscribe the token
//curl -X "DELETE" "http://localhost:8090/unsubscribe?secretscriptpath=test1.js&token=study.745&filepath=
func unsubscribeScript(c *fiber.Ctx)error{


	token := c.Query("token")

	if token==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty token")
	}

	fileName := c.Query("secretpath")

	if fileName==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty filename")
	}


	return db.DeletePath(token,fileName)

}
//curl -F  'jsscript=@./test.js' http://localhost:8090/updateScript?secretpath=1kWCcnwXblzwoFR5S01Shkxh62W_test.js
func updateScript(c *fiber.Ctx)error{

	file, err := c.FormFile("jsscript")

	if err!=nil{
		return fiber.NewError(fiber.StatusBadRequest,err.Error())
	}
	fileName := c.Query("secretpath")

	if fileName==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty filename")
	}

	path := fmt.Sprintf("./scripts/%s", fileName)
	
	return c.SaveFile(file,path)


}
//subscribeJSScript ... this is called when some one uploads the JS script file using CURL command
//curl -F 'jsscript=@./test.js' http://localhost:8090/uploadJSScript?token=study.745
func subscribeJSScript(c *fiber.Ctx)error{

	// Get first file from form field "document":
	file, err := c.FormFile("jsscript")

	if err!=nil{
		return fiber.NewError(fiber.StatusBadRequest,err.Error())
	}

	token := c.Query("token")
	
	if token==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty token")
	}

	err,actualpath := db.SetPath(token,file.Filename)

	if err!=nil{
		return fiber.NewError(fiber.StatusInternalServerError,err.Error())
	}
	
	// Save file to root directory:
	err = c.SaveFile(file,"./scripts/"+actualpath )
	if err!=nil{
		return fiber.NewError(fiber.StatusInternalServerError,err.Error())
	}

	return c.SendString(actualpath)
	
}

//subscribePYScript ... this is called when some one uploads the Python script file using CURL command
//curl -F 'jsscript=@./test.js' http://localhost:8090/uploadJSScript?token=study.745
func subscribePYScript(c *fiber.Ctx)error{

	// Get first file from form field "document":
	file, err := c.FormFile("pyscript")

	if err!=nil{
		return fiber.NewError(fiber.StatusBadRequest,err.Error())
	}
	// Save file to root directory:
	token := c.Query("token")

	if token==""{
		return fiber.NewError(fiber.StatusBadRequest,"empty token")
	}

	err,actualpath := db.SetPath(token,file.Filename)

	if err!=nil{
		return fiber.NewError(fiber.StatusInternalServerError,err.Error())
	}
	
	err = c.SaveFile(file,"./scripts/"+actualpath )
	if err!=nil{
		return fiber.NewError(fiber.StatusInternalServerError,err.Error())
	}

	return c.SendString(actualpath)
}
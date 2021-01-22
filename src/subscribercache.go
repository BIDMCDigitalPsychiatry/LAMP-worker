package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	_ "github.com/go-kivik/couchdb" // The CouchDB driver
	"github.com/go-kivik/kivik"
	"github.com/segmentio/ksuid"
)

//context used to connect to redis
var ctx = context.Background()

//Cache ... redis cache to store subscriber and token map
type Cache struct {

	rdb *kivik.DB
}
//NewCache ... returns a new cache struct instacne which holds the redis client instance
func NewCache(couchURL string) (*Cache,error){

	c := &Cache{}
	
	
	cl,err := kivik.New("couch", couchURL)

	if err != nil{
		return c,err
	}
	ok, err := cl.DBExists(ctx,"scriptpaths")

	if err!=nil{
		return c,err
	}
	
	//connect to a databse
	if !ok{
		err = cl.CreateDB(ctx,"scriptpaths")
		
	}
	c.rdb = cl.DB(ctx,"scriptpaths")
	return c,c.rdb.Err()
}
//returns the paths at token and retunrs an empty path if it does not exist
func (c *Cache)getOldPaths(token string)([]string,string,error){
	var paths []string
	var rev string
	row := c.rdb.Get(ctx,token)
	err := row.Err
	if err==nil{
		d := &struct{
		    ID string `json:"_id"`
			REV string `json:"_rev"`
			PATHS []string `json:"paths"`
		}{}
		err := row.ScanDoc(d)
		if err!=nil{
			log.Println("error getting paths:",err)
			return nil,"",err
		}
		rev = row.Rev
		paths = d.PATHS
		return paths,rev,nil
	}

	return nil,rev,err
}
//SetPath ... maps the path for the passed token
func (c *Cache)SetPath(token string,path string )(error,string){

	//recover from panic in case the uuid function panice in some rare scenario
	defer func() {
        if r := recover(); r != nil {
            log.Println("Recovered in f", r)
        }
    }()
	var actualpath string

	paths,rev,err := c.getOldPaths(token)
	doc := make(map[string]interface{},0)
	if rev !=""{
		doc["_rev"] = rev
	}

	if paths==nil{
		paths = make([]string,0)
		
	}
	actualpath = ksuid.New().String() + "_"+path
	paths = append(paths,actualpath)
	doc["_id"] = token
	doc["paths"] = paths
	
	_,err = c.rdb.Put(ctx,token,doc)
	if err!=nil{
		log.Println("error setting paths for token:",token,":",err)
		return err,""
	}
	return nil,actualpath
}
//GetPaths ... get tha paths saved in Redis for a token
func (c *Cache)GetPaths(token string)([]string,error){

	paths,_,err := c.getOldPaths(token)
	
	if err!=nil {
		return nil,err
	}
	if len(paths)==0{
		log.Printf("path empty for token %s : %v",token,err)
		return nil,errors.New("empty path")
	}
	return paths,nil
}

//DeletePath ... delete a path from the paths array set for the given token
func (c *Cache)DeletePath(token string,path string)error{

	paths,rev,err := c.getOldPaths(token)
	
	if err!=nil {
		log.Printf("error getting paths when trying to delete path for token %s : %v",token,err)
		return err
	}
	if len(paths)==0{
		log.Printf("path empty for token %s : %v",token,err)
		return errors.New("empty path")
	}
	newpaths := make([]string,0)
	for _,v := range paths{

		if v != path{
			newpaths = append(newpaths,v)
		}
	}
	
	doc := map[string]interface{}{
        "_id":      token,
		"_rev": rev,
		"paths":newpaths,
    }
	_,err = c.rdb.Put(ctx,token,doc)
	if err!=nil{
		log.Println("error setting new paths:",err)
		return err
		
	}
	fileName := fmt.Sprintf("./scripts/%s", path)
	err = os.Remove(fileName)
	return err
}


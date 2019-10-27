# -*- coding: utf-8 -*-
from __future__ import absolute_import, print_function

from flask import Flask, render_template, request, Response, jsonify, g, send_file, redirect
from jinja2 import Environment, meta, exceptions
from random import choice
from inspect import getmembers, isfunction
import os
import logging
import logging.handlers
import json
import yaml
import config
import uuid
import sqlite3
from io import BytesIO 
import codecs

app = Flask(__name__)

app.config['UPLOAD_FOLDER'] = os.path.join(app.root_path, "tmp")
app.config['DATABASE'] = os.path.join(app.config['UPLOAD_FOLDER'], 'database.db')
prefix = ""

#-----------------------------
# FOR AWS LAMBDA UNCOMMENT BELOW AND COMMENT ABOVE
#-----------------------------

#app.config['UPLOAD_FOLDER'] = "/tmp/"
#app.config['DATABASE'] = os.path.join(app.config['UPLOAD_FOLDER'], 'database.db' + str(uuid.uuid4().urn[9:]) )

#prefix for production - used in AWS LAMBDA "zappa update prod"
#prefix = "/prod"

if not os.path.exists(os.path.join(app.root_path, "tmp")):
        os.makedirs(os.path.join(app.root_path, "tmp"))

output_delimiter = "!------------------ NEXT SESSION"
outputs = {}


# check if db exists, create new one if not at start
if(not os.path.isfile(app.config['DATABASE'])):
    query_text = "CREATE TABLE templates(id TEXT PRIMARY KEY, name TEXT, content TEXT);"
    db = sqlite3.connect(app.config['DATABASE'])
    db.cursor().executescript(query_text)
    db.commit()
    db.close()
 


# helpers for sqlite
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(app.config['DATABASE'])

    def make_dicts(cursor, row):
        return dict((cursor.description[idx][0], value)
                    for idx, value in enumerate(row))
    db.row_factory = make_dicts

    return db





@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv
   

def guid():
    return uuid.uuid4().urn[9:]

# returns name and description from raw tag text
# tag format: [tag_name==tag desctition==]. 
def parseTag(tag):
    match = re.search('([^=]*)(==[^=]*==)?', tag)
    name, description = match.groups()
    if(description != None):
        description = description[2:-2]

    BOM = codecs.BOM_UTF8.decode('utf8')
    name = name.lstrip(BOM)
    return { "name": name, "description": description }

@app.route("/")
def home():
    return render_template('index.html', flag=1, prefix=prefix)

# load templates list
@app.route('/get_templates', methods=['GET'])
def getTemplates():
    templates = [x for x in query_db('select id, name from templates')]
    return jsonify(data=templates)

# load template config
@app.route('/get_template', methods=['GET'])
def getTemplate():
    id = request.args["id"]
    template = query_db('select * from templates where id=?', (id,), True)
    return jsonify(data=template)

# save template config
@app.route('/save_template', methods=['POST'])
def saveTemplate():
    id = request.form["id"]
    name = request.form["name"]
    content = request.form["content"] if "content" in request.form else "" 
    db = get_db()
    template = query_db('select * from templates where id=?', (id,), True)
    if template is None:
        db.execute("""
        INSERT INTO templates (id, name, content)
            VALUES (?, ?, ?)
        """, (id, name, content))
    else:
        db.execute("""
        UPDATE  templates set name = ?, content = ? WHERE id = ?
        """, (name, content, id))
    db.commit()
    return jsonify(data={"success": True})

# delete template
@app.route('/delete_template', methods=['GET'])
def deleteTemplate():
    id = request.args["id"] 
    db = get_db()
    db.execute("""
        DELETE FROM templates WHERE id=?
        """, (id,))
    db.commit()
    return jsonify(data={"success": True})

# check if template already exists and if name of template was changed 
@app.route('/check_template', methods=['GET'])
def checkTemplate():
    id = request.args["id"] if "id" in request.args else None 
    print(id)
    name = request.args["name"]
    print(name)
    template = query_db('select * from templates where id=?', (id,), True)
    print(template)
    data = {
        "can_save": True,
        "id": id,
    }
    if template is not None:
        if template["name"] != name:
            data["name"] = template["name"] 
            data["can_save"] = False
            data["name_changed"] = True
            data["new_id"] = guid()
    return jsonify(data=data)

# get tags from previously uploaded data file
@app.route('/get_tags', methods=['GET'])
def getTags():
    filename = request.args['filename']
    path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    tags, errors = _getTags(path)
    return jsonify(tags=tags, filename=filename)

# render template with data
@app.route('/convert', methods=['POST'])
def convert():
    try:
        print("start converting")
        # init jinja
        jinja2_env = Environment()

        # Load the template
        try:
            print("start parsing template")
            jinja2_tpl = jinja2_env.from_string(request.form['template'])
        except (exceptions.TemplateSyntaxError, exceptions.TemplateError) as e:
            return "Syntax error in jinja2 template: {0}".format(e)
        print("template parsed")

        result_texts = []

        as_archive = "as_archive" in request.form and request.form["as_archive"] == "true"
        zipFile = None

        # if download as archive, create in-memory archive
        if as_archive:
            from zipfile import ZipFile
            inMemoryOutputFile = BytesIO()
            zipFile = ZipFile(inMemoryOutputFile, 'w') 
            inMemoryOutputFile.seek(0)

        csv_filname = request.form["filename"]
        template_name = request.form["template_name"]
        # trim guid + '.csv' from the end of name
        human_csv_filname = csv_filname[:-41]
        path = os.path.join(app.config['UPLOAD_FOLDER'], csv_filname)
        error_lines = []
        with open(path, encoding='utf-8') as csvfile:
        #with open(path, encoding='ISO-8859-1') as csvfile:
            print("start converting")

            dialect = csv.Sniffer().sniff(csvfile.read(1024), delimiters=";,")
            csvfile.seek(0)
            reader = csv.reader(csvfile, dialect)
            
           # reader = csv.reader(csvfile,delimiter=delim)
            #You can change the delimiter here for the CSV File
            #reader = csv.reader(csvfile,delimiter=";")
            tags = None
            for i, row in enumerate(reader):
                if tags == None:
                    tags = [parseTag(x)["name"] for x in row]
                    print(tags)
                else:
                    try:
                        values = dict([ (name, row[i]) for i, name in enumerate(tags)])
                        print(values)
                        rendered_jinja2_tpl = jinja2_tpl.render(values)
                        if as_archive:
                            filename = human_csv_filname + "_" + str(i).rjust(4, "0") + ".txt"
                            filename = (template_name + "_" + filename) if template_name != "" else filename 
                            filename = values["FILE"] if "FILE" in values else filename 

                            zipFile.writestr(filename, rendered_jinja2_tpl)
                        else:
                            result_texts.append(rendered_jinja2_tpl)
                    except (ValueError, TypeError) as e:
                        row["line_number"] = i
                        error_lines.append(row)

        # if output is for download, save results in memory and return guid to download it from client
        if "download" in request.form:
            file_guid = guid()
            if as_archive:
                zipFile.close()
                inMemoryOutputFile.seek(0)
                outputs[file_guid] = inMemoryOutputFile 
            else:
                outputs[file_guid] = (os.linesep + output_delimiter + os.linesep).join(result_texts).replace("\n", os.linesep)
            return file_guid
        # else just send output text
        else:
            return ("<br />" + output_delimiter + " <br />").join(result_texts).replace("\n", "<br />")
    except Exception as ex:
        return str(ex)
# echoes back what was posted. used to download template text
@app.route('/echo_file', methods=['POST', 'GET'])
def echo_file():
    file_guid = guid()
    text = request.form["content"]
    outputs[file_guid] = text
    return file_guid

# find rendering results in dictionary and send it to client
@app.route('/download_output', methods=['POST', 'GET'])
def download_output():
    file_guid = request.args["file_id"]
    f = outputs[file_guid]
    outputs.pop(file_guid, None)

    if isinstance(f, BytesIO):
        return send_file(f, attachment_filename=request.args["file_name"], as_attachment=True)

    response = Response(f)
    response.headers["Content-Disposition"] = "attachment; filename=" + request.args["file_name"]
    return response

# get tags from path
@app.route('/get_tags', methods=['POST'])
def get_tags():
    filename = request.form["filename"]
    human_filename = request.form["human_filename"]
    
    path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    tags, errors = _getTags(path)
    data = [{
            "tags": tags,
            "filename": filename,
            "filename_human": human_filename,
            "errors": errors
        }]

    return jsonify(data=data)


import csv
import re

# gets th first fow of csv and returns parsed tags list
def _getTags(path):
    errors = []
    tags = []
    try:
        with open(path, encoding='utf-8') as csvfile:
        #with open(path, encoding='ISO-8859-1') as csvfile:
            #reader = csv.reader(csvfile, delimiter=delim)
            dialect = csv.Sniffer().sniff(csvfile.read(1024), delimiters=";,")
            csvfile.seek(0)
            reader = csv.reader(csvfile, dialect)

            row = reader.__next__()
            print(row)
            
            tags = [parseTag(x) for x in row]
    except Exception as ex:
        errors.append("Failed to read tags" + str(ex) + str(tags) + "Delimiter is " + str(dialect) + "Path " + str(path) )
        #errors.append("Failed to read tags : " + str(ex) + str(tags) + " Delimiter is " + str(delim)   )
    return (tags, errors)

# uploads data file and returns it's id, name and tags list
@app.route('/upload', methods=['POST'])
def upload_file():
    print("loading file")
    print(request.files.getlist("file"))

    data = []
    for file in request.files.getlist("file"):
        errors = []

        filename = guid() + ".csv" 

        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        try:
            file.save(path)
        except Exception as ex:
            errors.append(str(ex))
        tags, errors = _getTags(path)
        data.append({
            "tags": tags,
            "filename": filename,
            "filename_human": file.filename,
            "errors": errors
        })

    return jsonify(data=data)

#if ( app.debug ):
#        from werkzeug.debug import DebuggedApplication
#        app.wsgi_app = DebuggedApplication( app.wsgi_app, True )

if __name__ == "__main__":
    app.run(
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG,
    )

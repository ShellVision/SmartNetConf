$(document).ready(function () {

    // helper to thottle executio of repeating event handers 
    var throttle = function throttle(fn, delay) {
        var timer = null;
        return function () {
            var context = this,
                args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(context, args);
            }, delay);
        };
    };

    function guid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0,
                v = c == 'x' ? r : r & 0x3 | 0x8;
            return v.toString(16);
        });
    }

    // load state from local storage. use defaults if not found
    state = $.extend({
        // user's templates list
        templates: {},
        // current template
        template_id: "",
        // tags state
        tags: {
            // is user dropping files 
            dragover: false,
            // current user files state
            files: []
        },
        // rendered output
        output: "",
        // filter text for tags
        tags_filter_text: "",
        // panel sizes
        vertical_split: 75,
        horizontal_split: 75,
        // download mode 
        download_as_archive: false
    }, JSON.parse(localStorage.getItem("state")), {
        // stuff only needed when app is currently working. is not saved
            local: {
                files_uploading: [],
                loading_templates_list: false,
                templates_list: [],
                loading_output: false,
                loading_template: false
            }
        });

    // get current active template. if not found, create new one
    function getCurrentTemplate() {
        if (!state.template_id) {
            state.template_id = guid();
        }
        if (!state.templates[state.template_id]) {
            state.templates[state.template_id] = {
                name: "",
                content: "",
                used_data_file: "",
                id: state.template_id
            };
        }
        if (!state.curentTemplate || state.curentTemplate.id != state.template_id) {
            state.curentTemplate = state.templates[state.template_id];
        }
        return state.templates[state.template_id];
    }

    // save state every 2 seconds
    setInterval(function () {
        localStorage.setItem("state", JSON.stringify(state));
    }, 1000);

    // helper to highlight parts of text when searching them
    function highlightSearch(string, filter) {
        return string.replace(new RegExp("(" + filter.trim() + ")", "gi"), '<span class="search-highlight">$1</span>');
    }

    var colors = ["#ff0000", "#ff4000", "#ff8000", "#ffbf00", "#ffff00", "#bfff00", "#80ff00", "#40ff00", "#00ff00", "#00ff40", "#00ff80", "#00ffbf", "#00ffff", "#00bfff", "#0080ff", "#0040ff", "#0000ff", "#4000ff", "#8000ff", "#bf00ff", "#ff00ff", "#ff00bf", "#ff0080", "#ff0040", "#ff0000"];

    // helper to choose font color depending on background color
    /// http://stackoverflow.com/a/3943023
    colors_skip = 5;
    function getTextColorForBackground(background_color) {
        function hexToRgb(hex) {
            var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        }
        var c = hexToRgb(background_color);
        var L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        return L > 0.179 ? "#000000" : "#ffffff";
    }

    var app = new Vue({
        el: '#viewport',
        data: state,
        computed: {
            // raw tags data converted for use in view
            files_filtered: function files_filtered() {
                return this.tags.files.map(function (file) {
                    var file_id = file.filename;
                    return {
                        name: file.filename_human,
                        id: file_id,
                        is_loading: state.local.files_uploading.some(function (x) {
                            return x == file.filename_human;
                        }),
                        error: (file.errors || []).join("<br />"),
                        is_not_used: file_id != getCurrentTemplate().used_data_file,
                        color: file.color || colors[8],
                        text_color: getTextColorForBackground(file.color || colors[8]),
                        tags: file.tags.filter(function (tag) {
                            return tag.name.match(RegExp(state.tags_filter_text.trim()), "gi");
                        }).map(function (tag) {
                            return {
                                name: tag.name,
                                text: highlightSearch(tag.name, state.tags_filter_text),
                                id: file_id + "_" + tag.name,
                                description: tag.description
                            };
                        })
                    };
                });
            },
            template: function template() {
                return getCurrentTemplate();
            },
            data_file_name: function data_file_name() {
                return getFileName(true) || "NOT SELECTED";
            }
        },
        methods: {
            use_data_file: function use_data_file(id) {
                // debugger;
                getCurrentTemplate().used_data_file = id;
                processTemplate();
            },
            close_data_file: function close_data_file(id) {
                // debugger;
                var tpl = getCurrentTemplate();
                if (tpl.used_data_file == id) {
                    tpl.used_data_file = "";
                }
                state.tags.files = state.tags.files.filter(function (x) {
                    return x.filename != id;
                });
                processTemplate();
            },
            set_tag_drag_text: function set_tag_drag_text(name, ev) {
                console.log(ev);
                ev.dataTransfer.setData("text", "{{" + name + "}}");
            },
            load_template: function load_template(id) {
                state.local.loading_template = true;

                $.get('/get_template', {
                    id: id
                }).done(function (resp) {
                    setTimeout(function () {
                        state.local.loading_template = false;
                    }, 250);
                    loadTemplate(resp.data);
                });
            },
            delete_template: function delete_template(id, e) {
                e.preventDefault();
                e.stopPropagation();
                BootstrapDialog.show({
                    message: "Deleting template: [" + state.local.templates_list.filter(function (x) {
                        return x.id == id;
                    })[0].name + "]",
                    buttons: [{
                        "label": "Delete",
                        "action": function action(dialog) {
                            $.get('/delete_template', {
                                id: id
                            }).done(function (resp) {
                                dialog.close();
                                if (id == state.template_id) {
                                    loadTemplate({});
                                }
                                state.local.templates_list = state.local.templates_list.filter(function (x) {
                                    return x.id != id;
                                });
                            });
                        }
                    }, {
                        "label": "Cancel",
                        "action": function action(dialog) {
                            dialog.close();
                        }
                    }]
                });
            },
            toggle_results_download_mode: function(){
                state.download_as_archive = !state.download_as_archive;
            }
        },
        delimiters: ['${', '}']
    });

    // use new teplate and update UI and state with it's data
    function loadTemplate(template) {
        state.output = "";
        state.template_id = template.id;
        var tpl = getCurrentTemplate();

        tpl.name = template.name || "";
        setTemplateContent(template.content || "", true);
        state.tags_filter_text = "";
    }

    // getters and setters for state fields.

    function getTemplateContent() {
        return getCurrentTemplate().content;
    }

    function setTemplateContent(val, updateUI) {
        getCurrentTemplate().content = val;
        if (updateUI) {
            editor.setValue(val);
        }
    }

    function getTemplateId() {
        return getCurrentTemplate().id;
    }

    function getTemplateName() {
        return getCurrentTemplate().name;
    }

    function setTemplateName(name) {
        getCurrentTemplate().name = name;
    }

    // returns current data file name.
    // returns empty name if template tries to use data file that was deleted on client
    function getFileName(isForHumans) {
        var name = getCurrentTemplate().used_data_file || "";
        if (state.tags.files.filter(function (x) {
            return x.filename == name;
        }).length == 0) {
            return "";
        }
        // guid + .csv is added to filename for uniqueness. 
        // remove that part if need to show name in ui
        if (isForHumans) {
            name = name.substr(0, name.length - 41);
        }
        return name;
    }

    // activate tooltips
    $('[data-toggle="tooltip"]').tooltip({html: true, container: "body"});

    // Open button for template.
    // When clicked, loads data from server and shows a list of templates
    $('#open-button').on('show.bs.dropdown', function () {
        // show "Loading..."
        state.local.loading_templates_list = true;
        // empty current templates list
        state.local.templates_list = [];
        // load list from server
        $.get('/get_templates', {}).done(function (response) {
            // set new list of templates
            state.local.templates_list = response.data;
            // hide "Loading..."
            state.local.loading_templates_list = false;
            // apply tooltips after some time when Vue rendered html elements 
            setTimeout(function () {
                $('[data-toggle="tooltip"]').tooltip({html: true, container: "body"});
            }, 250);
        });
    });

    // New button for templates. creates new template
    $("#new-button").on("click", function () {
        loadTemplate({});
    });

    // Download button for results
    $("#download-output-button").on("click", function () {
        $.post('/convert', {
            template: getTemplateContent(),
            filename: getFileName(),
            download: true,
            as_archive: state.download_as_archive,
            template_name: getTemplateName()
        }).done(function (response) {
            var ext = state.download_as_archive ? "zip" : "txt";
            window.location = "/download_output?file_id=" + response + "&file_name=" + getTemplateName() + "_" + getFileName(true) + "_output." + ext + "&template_name=" + (getTemplateName() || "");
        });
    });

    $("#download-template-button").on("click", function () {
        $.post('/echo_file', {
            content: getTemplateContent()
        }).done(function (response) {
            window.location = "/download_output?file_id=" + response + "&file_name=" + getTemplateName() + ".txt";
        });
    });

    var isAdvancedUpload = function() {
        var div = document.createElement('div');
        return (('draggable' in div) || ('ondragstart' in div && 'ondrop' in div)) && 'FormData' in window && 'FileReader' in window;
    }();

    var $form = $('.box');
    var $input    = $form.find('input[type="file"]');

    if (isAdvancedUpload) {
        
        $form.addClass('has-advanced-upload');

        var droppedFiles = false;

        $form.on('drag dragstart dragend dragover dragenter dragleave drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
        })

        .on('dragover dragenter', function() {
            $form.addClass('is-dragover');
        })

        .on('dragleave dragend drop', function() {
            $form.removeClass('is-dragover');
        })

        .on('drop', function(e) {
            droppedFiles = e.originalEvent.dataTransfer.files;
            $form.trigger('submit');
        });

        $input.on('change', function(e) { // when drag & drop is NOT supported
            droppedFiles = e.target.files;
            $form.trigger('submit');
        });
    
        $form.on('submit', function(e) {

            if ($form.hasClass('is-uploading')) return false;

            $form.addClass('is-uploading').removeClass('is-error');

            if (isAdvancedUpload) {
                e.preventDefault();
    
                var ajaxData = new FormData();

                state.local.files_uploading = [];

                if (droppedFiles) {
                    $.each( droppedFiles, function(i, file) {
                        ajaxData.append( 'file', file );
                        // find if file with the same name is already uploaded
                        var old = state.tags.files.filter(function (q) {
                            return q.filename_human == droppedFiles[i].name;
                        });
                        // if not, add it to files list to show upload process in UI
                        if (old.length == 0) {
                            state.tags.files.unshift({
                                filename_human: droppedFiles[i].name,
                                filename: "",
                                tags: [],
                                color: colors[(state.tags.files.length * colors_skip + 3) % colors.length]
                            });
                        } else {
                        // else just clear tags list
                            old[0].tags = [];
                        }
                        // update state to show spinners near loading files in UI
                        state.local.files_uploading.push(droppedFiles[i].name);
                    });
                }
        
                var tpl = getCurrentTemplate();
                
                $.ajax({
                    url: $form.attr('action'),
                    type: $form.attr('method'),
                    data: ajaxData,
                    dataType: 'json',
                    cache: false,
                    contentType: false,
                    processData: false,
                    complete: function() {
                        $form.removeClass('is-uploading');
                        setTimeout(function () {
                            state.local.files_uploading = [];
                        }, 250);
                    },
                    success: function(data) {
                        $form.addClass( data.success == true ? 'is-success' : 'is-error' );
                        data.data.forEach(function (file) {
                            var old = state.tags.files.filter(function (q) {
                                return q.filename_human == file.filename_human;
                            })[0];
                            if (old.filename == tpl.used_data_file){
                                tpl.used_data_file = file.filename; 
                            }
                            old.filename = file.filename;
                            old.tags = file.tags;
                            old.errors = file.errors;
                        });
                    
                        // if no file is used for template currently, use the first dropped one
                        if (!tpl.used_data_file) {
                            tpl.used_data_file = state.tags.files[0].filename;
                        }
                        // show tooltips after Vue rendered html
                        setTimeout(function () {
                            $('[data-toggle="tooltip"]').tooltip({html: true, container: "body"});
                        }, 250);
                        state.tags_filter_text = "";
                        processTemplate();
                    },
                    error: function() {
                        // Log the error, show an alert, whatever works for you
                        alert("file upload error!");
                    }
                });
            } else {
                var iframeName  = 'uploadiframe' + new Date().getTime();
                $iframe   = $('<iframe name="' + iframeName + '" style="display: none;"></iframe>');

                $('body').append($iframe);
                $form.attr('target', iframeName);

                $iframe.one('load', function() {
                    var data = JSON.parse($iframe.contents().find('body' ).text());
                    $form
                    .removeClass('is-uploading')
                    .addClass(data.success == true ? 'is-success' : 'is-error')
                    .removeAttr('target');
                    if (!data.success) $errorMsg.text(data.error);
                    $form.removeAttr('target');
                    $iframe.remove();
                });
            }
        });
    }
    
    // save template button
    $("#save-button").on("click", function () {
        function saveTemplate(id, name, content) {
            return $.post('/save_template', {
                id: id,
                name: name,
                content: content
            }).done(function () {
                var name = getTemplateName();
                var content = getTemplateContent();
                var file_name = getFileName();
                loadTemplate({
                    id: id,
                    name: name,
                    content: content,
                    file_name: file_name
                });
            });
        }

        if (!getTemplateName()) {
            BootstrapDialog.show({
                message: "Enter a template name before saving"
            });
            return;
        }

        // check if file was renamed
        $.get('/check_template', {
            id: getTemplateId(),
            name: getTemplateName()
        }).done(function (response) {
            var data = response.data;
            if (data.name_changed) {
                // show dialog if was
                BootstrapDialog.show({
                    message: "Name was changed. Previous name: [" + data.name + "]",
                    buttons: [{
                        "label": "Save and rename",
                        "action": function action(dialog) {
                            dialog.close();
                            saveTemplate(data.id, getTemplateName(), editor.getValue());
                        }
                    }, {
                        "label": "Save as new",
                        "action": function action(dialog) {
                            dialog.close();
                            saveTemplate(data.new_id, getTemplateName(), editor.getValue());
                        }
                    }, {
                        "label": "Cancel",
                        "action": function action(dialog) {
                            dialog.close();
                        }
                    }]
                });
            } else {
                // just save if wasn't renamed'
                saveTemplate(data.id, getTemplateName(), editor.getValue());
            }
        });
    });

    // allow to resize panels
    // 
    var v_split = Math.ceil(state.vertical_split);
    console.log("loaded v_split", v_split);
    if (!v_split) {
        v_split = 75;
    }

    Split(['#a', '#b'], {
        sizes: [v_split, 100 - v_split],
        direction: 'vertical',
        gutterSize: 8,
        cursor: 'col-resize',
        // save sizes to state
        onDragEnd: function onDragEnd() {
            var w1 = $("#a").height();
            var w2 = $("#b").height();
            var v_split = 100 * w1 / (w1 + w2);
            state.vertical_split = v_split;
            console.log("saving v_split", v_split);
        }
    });

    // load sizes from state
    var h_split = Math.ceil(state.horizontal_split);
    console.log("loaded h_split", h_split);
    if (!h_split) {
        h_split = 75;
    }

    Split(['#c', '#tags-panel'], {
        sizes: [h_split, 100 - h_split],
        gutterSize: 8,
        cursor: 'row-resize',
        // save sizes to state
        onDragEnd: function onDragEnd() {
            var w1 = $("#c").width();
            var w2 = $("#tags-panel").width();
            var h_split = 100 * w1 / (w1 + w2);
            state.horizontal_split = h_split;
            console.log("savin h_split", h_split);
        }
    });

    // init ACE
    var editor = ace.edit("template");
    editor.getSession().setMode("ace/mode/python");
    editor.setTheme("ace/theme/vibrant_ink")
    //editor.setOption("useWorker", true);
    //editor.setMode("ace/mode/python")

    var template = getTemplateContent();
    if (template) {
        editor.setValue(template);
    }

    // save state on change
    editor.on("change", function () {
        getCurrentTemplate().content = editor.getValue();
    });

    // after delay, render template
    editor.on("change", throttle(function () {
        processTemplate();
    }, 1500));

    // send data to server to render template and updates results
    function processTemplate() {
        if (!getFileName()) {
            state.output = "";
            return;
        }
        state.local.loading_output = true;
        $.post('/convert', {
            template: getTemplateContent(),
            filename: getFileName(),
            template_name: getTemplateName()
        }).done(function (response) {
            state.output = response;
            setTimeout(function () {
                state.local.loading_output = false;
            }, 250);
        });
    }

    loadTemplate(getCurrentTemplate());
});


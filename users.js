"use strict";

const silentMode = true;
let consoleLog = (...args) => { 
 if (!silentMode) { console.log(...args) }
}

// get a list of users on the page
function getAuthors() {
    let authors = [];

    let userElems = document.evaluate(
        '//a[' + userElemEval + ']',
        document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    let i = 0;
    while (userElems.snapshotItem(i)) {
        let author = userElems.snapshotItem(i).textContent.replace(/^u\//, '');

        // if not already in our list of authors
        if (author &&
            author != '' &&
            authors.indexOf(author) < 0 &&
            author != '[deleted]' &&
            author != 'AutoModerator' &&
            author != 'PoliticsModeratorBot' &&
            author != 'LegalAdviceModerator' &&
            author != 'court-reporter' &&
            author != 'Invite to chat') {

            authors.push(author);
        }
        i++;
    }

    return authors;
}


function SubStats() {
    let empty = function() {
        this.average = null;
        this.total = 0
        this.length = 0;
    };

    this.link = new empty();
    this.comment = new empty();
}


function User(username, init = true) {
    printLog('User():', username);

    this.name = username;
    this.about = {
        updated: null
    };
    this.comments = null;
    this.working = false;
    this.hasTag = false;
    this.tags = {};
    this.stats = {
        links: {
            updated: null,
            average: null,
            total: 0
        },
        comments: {
            updated: null,
            average: null,
            total: 0
        },
        subreddits: {}
    };



    this.getComments = function() {
        // wait for the user to load from the db
        if (this.stats.comments.updated == null) {
            // consoleLog('getComments() waiting on user from db:', this.name);
            setTimeout(() => {
                this.getComments();
            }, 100);
            return;
        }
        printLog('\tgetComments:', this.name);

        // consoleLog(this.comments);

        if (!this.comments || !this.comments[0] || !this.comments[0].name) {
            this.comments = [];
            this.getCommentsJson('after');
        } else if (!this.stats.comments.updated || (datenow() - this.stats.comments.updated) > cacheTime) {
            this.getCommentsJson('before', this.comments[0]);
        } else {
            this.evalComments();
        }
    }

    this.getCommentsJson = async function(type = 'after', id = null) {
        let domain = window.location.hostname;
        let url = 'https://' + domain + '/user/' + this.name + '/comments.json?sort=new&limit=100';

        if (id) {
            url += '&' + type + '=' + id;
        }
        let results = await chrome.runtime.sendMessage({
            contentScriptQuery: "queryComment",
            url: url,
            type: type,
            user: this
        });
	
		consoleLog('\t\t\tqueryComment(' + this.name + ')');
		let json = results.json;
		if (json.data) { 
		  json.data.before = (json.data.children?.[0]) ? json.data.children[0].data.name : null;
		this.saveComments(results.type, results.json);
		}
		if (json?.data?.[results.type]) {
			this.getCommentsJson(results.type, json.data[type]);
		} else {
			this.evalComments();
		}
		return true;
    }


    this.saveComments = function(type, json) {
        consoleLog('\t\t\tsaveComments(' + type + ')');

        let saved = [];
        json.data?.children.forEach((comment) => {
            let save = {
                // parent_id:		comment.data.parent_id,
                // permalink:		comment.data.permalink,
                // body:			comment.data.body,
                // ups:				comment.data.ups,
                name: comment.data.name,
                created: comment.data.created_utc,
                subreddit: comment.data.subreddit,
                controversiality: comment.data.controversiality,
                score: comment.data.score,
            };

            saved.push(save);
        });

        if (type == 'after') {
            if (this.comments === null) {
                this.comments = [];
            }
            this.comments = this.comments.concat(saved);
        } else {
            this.comments = saved.concat(this.comments);
        }
    }

    this.evalComments = function() {
        printLog('\t\tevalComments():', this.name);

        // keep up to 1000 comments, discard old ones over 1000
        if (this.comments.length >= 1000) {
            this.comments.splice(1000, this.comments.length - 1);
        }

        this.stats.comments.total = 0;
        this.comments.forEach((comment) => {
            if (comment !== null) {
                this.stats.comments.total += comment.score;
            }
        });
        let scoreAvg = Math.round(this.stats.comments.total / this.comments.length * 100) / 100;
        this.stats.comments.average = scoreAvg;


        this.stats.subreddits = {};
        this.comments.forEach((comment) => {
            if (comment !== null) {
                if (!this.stats.subreddits[comment.subreddit]) {
                    this.stats.subreddits[comment.subreddit] = new SubStats;
                }
                let sub = this.stats.subreddits[comment.subreddit];
                sub.comment.total += comment.score;
                sub.comment.length++;
                sub.comment.average = Math.round(sub.comment.total / sub.comment.length * 100) / 100;
            }
        });

        this.stats.comments.updated = datenow();
        this.evalTags();
    }


    this.evalTags = function() {
        printLog('\t\t\tevalTags():', this.name);
        // wait for the user info to be updated
        if (this.about.created == null) {
            // consoleLog('evalTags() waiting on user about:', this.name);
            setTimeout(() => {
                this.evalTags();
            }, 100);
            return;
        }

        let statsTableLength = 10;

        for (let type in settings.tags) {
            this.tags[type] = {}
            for (let tag in settings.tags[type]) {
                if (!settings.tags[type][tag].enabled) {
                    continue;
                }

                if (type == 'accountage') {
                    let age = Math.round((datenow() - this.about.created) / day);
                    if ((settings.tags[type][tag].gtlt == 'greater' && age > settings.tags[type][tag].age) ||
                        (settings.tags[type][tag].gtlt != 'greater' && age < settings.tags[type][tag].age)) {
                        this.tags[type][tag] = true;
                        this.hasTag = true;
                    }

                } else if (type == 'subreddits') {
                    settings.tags[type][tag].list.forEach((sub) => {
                        if (!sub || !this.stats.subreddits[sub]) {
                            return;
                        }
                        if (settings.tags[type][tag].avgtotal == 'average' && this.stats.subreddits[sub].comment.length < 10) {
                            return;
                        }

                        let comparator = (settings.tags[type][tag].avgtotal == 'total') ? this.stats.subreddits[sub].comment.total : this.stats.subreddits[sub].comment.average;

                        if ((settings.tags[type][tag].gtlt == 'greater' && comparator > settings.tags[type][tag].karma) ||
                            (settings.tags[type][tag].gtlt != 'greater' && comparator < settings.tags[type][tag].karma)) {
                            let subs = this.subSort(type, tag, settings.tags[type][tag].list);
                            subs.splice(statsTableLength);
                            this.tags[type][tag] = subs;
                            this.hasTag = true;
                            return;
                        }
                    });

                } else if (type == 'subkarma') {
                    let url = window.location.href.split('/');
                    let urlSubs = (url[3] == 'r') ? url[4].split('+') : [];
                    let subs = [];
                    urlSubs.forEach((sub) => {
                        if (!sub || !this.stats.subreddits[sub]) {
                            return;
                        }
                        if (settings.tags[type][tag].avgtotal == 'average' && this.stats.subreddits[sub].comment.length < 10) {
                            return;
                        }

                        let comparator = (settings.tags[type][tag].avgtotal == 'total') ? this.stats.subreddits[sub].comment.total : this.stats.subreddits[sub].comment.average;

                        if ((settings.tags[type][tag].gtlt == 'greater' && comparator > settings.tags[type][tag].karma) ||
                            (settings.tags[type][tag].gtlt != 'greater' && comparator < settings.tags[type][tag].karma)) {
                            subs.push(sub);
                        }
                    });

                    if (subs.length) {
                        subs = this.subSort(type, tag, subs);
                        subs.splice(statsTableLength);
                        this.tags[type][tag] = subs;
                        this.hasTag = true;
                    }

                } else if (type == 'karma') {
                    let comparator = (settings.tags[type][tag].avgtotal == 'total') ? this.stats.comments.total : this.stats.comments.average;

                    if ((settings.tags[type][tag].gtlt == 'greater' && comparator > settings.tags[type][tag].karma) ||
                        (settings.tags[type][tag].gtlt != 'greater' && comparator < settings.tags[type][tag].karma)) {

                        let subs = this.subSort(type, tag, Object.keys(this.stats.subreddits));
                        subs.splice(statsTableLength);

                        this.tags[type][tag] = subs;
                        this.hasTag = true;
                    }

                }
            }
        }
        this.saveDb();
    }

    this.subSort = function(type, tag, subs) {
        let sortBy = [];
        // for (let sub in subs) {
        subs.forEach((sub) => {
            if (!(sub in this.stats.subreddits)) {
                return;
            }
            sortBy[sub] = (settings.tags[type][tag].avgtotal == 'total') ? this.stats.subreddits[sub].comment.total : this.stats.subreddits[sub].comment.average;
        });

        subs = Object.keys(sortBy).sort(function(a, b) {
            return sortBy[b] - sortBy[a];
        });

        if (settings.tags[type][tag].gtlt != 'greater') {
            subs = subs.reverse();
        }

        return subs;
    }




    this.addTags = function() {
        // wait on tags to be generated
        if (!Object.keys(this.tags).length) {
            setTimeout(() => {
                this.addTags();
            }, 100);
            return;
        }
        if (!this.hasTag) {
            return;
        }
        printLog('\t\t\t\taddTags():', this.name);

        let userElems = this.getUserElemements();
        // consoleLog(userElems);

        userElems.forEach((userElem) => {
            let wrapper = this.tagWrapper();
            for (let type in this.tags) {
                for (let tag in this.tags[type]) {
                    let tagSpan = this.tagSpan(type, tag);

                    wrapper.appendChild(tagSpan);
                }
            }
            setTimeout(function() {
                userElem.before(wrapper);
            }, Math.random() * 500);
        });


        this.working = false;
    }

    this.getUserElemements = function() {
        let userLinks = [];
        let userElems = document.evaluate(
            '//a[' + userElemEval + ' and (text()="u/' + this.name + '" or text()="' + this.name + '")]',
            document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

        let i = 0;
        while (userElems.snapshotItem(i)) {
            let userElem = userElems.snapshotItem(i);

            // if it doesn't already have a tag...
            if (!userElem.previousSibling ||
                !userElem.previousSibling.tagName ||
                (userElem.previousSibling.tagName != 'SPAN' || !userElem.previousSibling.className.split(' ').includes('rptTagWrapper'))) {
                userLinks.push(userElem);
            }
            i++;
        }

        return userLinks.reverse();
    }

    this.tagWrapper = function() {
        let span = document.createElement('span');
        span.className = 'rptTagWrapper rptUser-' + this.name;
        return span;
    }

    this.tagSpan = function(type, tag) {
        let span = document.createElement('span');
        span.textContent = tag;
        // span.className = 'rptTag rptUser-' + this.name;
        span.className = 'rptTag';
        span.style.backgroundColor = '#' + settings.tags[type][tag].color;
        span.style.color = '#' + settings.tags[type][tag].tcolor;

        let displayTag = span.cloneNode(true);

        span.addEventListener('mouseenter', (e) => {
            let hoverDiv = document.createElement('div');
            hoverDiv.className = 'rptTagInfo';

            let zIndex = 1000000;
            if (span.parentElement.className.split(' ').includes('fieldPair-text')) {
                zIndex = window.getComputedStyle(span.parentElement.parentElement.parentElement.parentElement.parentElement).getPropertyValue('z-index') + 10;
            }
            hoverDiv.style.zIndex = zIndex;

            hoverDiv.addEventListener('mouseleave', (e) => {
                hoverDiv.parentNode.removeChild(hoverDiv);
            });

            let header = document.createElement('div');
            header.className = 'rptTagInfoHeader textCenter';

            let rpt = document.createElement('div');
            rpt.style.color = '#ff0000';
            rpt.style.fontSize = '130%';
            rpt.style.marginBottom = '5px';
            rpt.textContent = 'Reddit Pro Tools';
            rpt.className = 'textCenter bold';

            let userLink = document.createElement('a');
            userLink.href = '/u/' + this.name;
            userLink.textContent = '/u/' + this.name;

            let colon = document.createElement('span');
            colon.textContent = ': ';

            header.appendChild(userLink);
            header.appendChild(colon);
            header.appendChild(displayTag);

            let tagDesc = document.createElement('div');
            tagDesc.className = 'rptTagInfoDesc textCenter bold';

            let body = document.createElement('div');
            body.className = 'rptTagInfoBody textCenter';

            if (type == 'accountage') {
                let year = 365.25;
                let age = Math.round((datenow() - this.about.created) / day);
                let years = Math.floor(age / year);
                let months = Math.floor(age % year / year * 12);
                let days = Math.floor(age - years * year - months * year / 12);

                let ageText = (years) ? years + ' years,' : '';
                ageText += (months) ? ' ' + months + ' months,' : ''
                ageText += (days) ? ' ' + days + ' days' : '< 1 day';

                tagDesc.textContent = 'Account age ' + settings.tags[type][tag].gtlt + ' than ' + numPretty(settings.tags[type][tag].age) + ' days';
                body.textContent = 'Account age: ' + ageText;

            } else if (type == 'subreddits') {
                let subLimit = 4;
                let subsText = '';
                for (let i in settings.tags[type][tag].list) {
                    if (i > subLimit - 1) {
                        continue;
                    }
                    if (i != 0) {
                        subsText += ', ';
                    }
                    subsText += settings.tags[type][tag].list[i];
                }
                if (settings.tags[type][tag].list.length > subLimit) {
                    subsText += ', ...';
                }

                tagDesc.textContent = 'Comment karma ' + settings.tags[type][tag].gtlt + ' than ' + numPretty(settings.tags[type][tag].karma) + ' in:';

                let subsDiv = document.createElement('div');
                subsDiv.style.fontWeight = 'normal';
                subsDiv.textContent = '(' + subsText + ')';
                tagDesc.append(subsDiv);

                body.append(this.statsTable(this.tags[type][tag]));

            } else if (type == 'subkarma') {
                tagDesc.textContent = 'Comment karma ' + settings.tags[type][tag].gtlt + ' than ' + numPretty(settings.tags[type][tag].karma) + ' in current subreddit';
                body.append(this.statsTable(this.tags[type][tag]));

            } else if (type == 'karma') {
                tagDesc.textContent = 'Total comment karma ' + settings.tags[type][tag].gtlt + ' than ' + numPretty(settings.tags[type][tag].karma);
                body.append(this.statsTable(this.tags[type][tag]));

            } else if (type == 'rptStats') {
                if (tag == 'RPT+') {
                    tagDesc.textContent = 'Subreddits by positive comment karma';

                    let subs = this.subSort(type, tag, Object.keys(this.stats.subreddits));
                    subs.splice(10);

                    body.append(this.statsTable(subs));
                } else if (tag == 'RPT-') {
                    tagDesc.textContent = 'Subreddits by negative comment karma';

                    let subs = this.subSort(type, tag, Object.keys(this.stats.subreddits));
                    subs.splice(10);

                    body.append(this.statsTable(subs));
                }
            }

            hoverDiv.appendChild(rpt);
            hoverDiv.appendChild(header);
            hoverDiv.appendChild(tagDesc);
            hoverDiv.appendChild(body);

            document.body.appendChild(hoverDiv);
            this.positionRptTagInfo(hoverDiv, e.pageX, e.pageY);
        });

        return span;
    }

    this.positionRptTagInfo = function(div, pageX, pageY) {
        div.style.left = (pageX - 50) + 'px';
        div.style.top = (pageY - 20) + 'px';

        let pos = $(div)[0].getBoundingClientRect();

        if (0 > pos.left) {
            div.css('left', '0px');
        }
        if (0 > pos.top) {
            div.style.top = document.documentElement.scrollTop + 'px';
        }
        if (pos.right > window.innerWidth) {
            div.style.left = (document.documentElement.scrollLeft + window.innerWidth - pos.width - 20) + 'px';
        }
        if (pos.bottom > window.innerHeight) {
            div.style.top = (document.documentElement.scrollTop + window.innerHeight - pos.height) + 'px';
        }
    }

    this.statsTable = function(subs) {
        let table = document.createElement('table');
        table.style.width = '100%';

        let tr = document.createElement('tr');
        let td = document.createElement('td');
        td.style.paddingLeft = '5px';
        td.style.paddingRight = '5px';

        let thSubreddit = td.cloneNode();
        thSubreddit.className = 'rptBorder';
        thSubreddit.style.borderWidth = '0px 1px 1px 0px';
        thSubreddit.textContent = 'Subreddit';

        let thTotal = td.cloneNode();
        thTotal.className = 'rptBorder';
        thTotal.style.borderWidth = '0px 1px 1px 0px';
        thTotal.textContent = 'Total Karma';

        let thAverage = td.cloneNode();
        thAverage.className = 'rptBorder';
        thAverage.style.borderWidth = '0px 1px 1px 0px';
        thAverage.textContent = 'Average Karma';

        let thComments = td.cloneNode();
        thComments.className = 'rptBorder';
        thComments.style.borderWidth = '0px 0px 1px 0px';
        thComments.textContent = 'Comments';

        let th = tr.cloneNode();
        th.appendChild(thSubreddit);
        th.appendChild(thTotal);
        th.appendChild(thAverage);
        th.appendChild(thComments);
        table.appendChild(th);


        subs.forEach((sub) => {
            let trStats = tr.cloneNode();

            let tdSubreddit = td.cloneNode();
            tdSubreddit.textContent = sub;

            let tdTotal = td.cloneNode();
            tdTotal.textContent = numPretty(this.stats.subreddits[sub].comment.total);

            let tdAverage = td.cloneNode();
            tdAverage.textContent = numPretty(this.stats.subreddits[sub].comment.average);

            let tdComments = td.cloneNode();
            tdComments.textContent = numPretty(this.stats.subreddits[sub].comment.length);

            trStats.appendChild(tdSubreddit);
            trStats.appendChild(tdTotal);
            trStats.appendChild(tdAverage);
            trStats.appendChild(tdComments);
            table.appendChild(trStats);
        });

        return table;
    }




    this.getAbout = async function() {
        // wait for the db to load the user
        if (this.about.updated == null) {
            // consoleLog('waiting on user from db:', this.name);
            setTimeout(() => {
                this.getAbout();
            }, 100);
            return;
        }
        consoleLog('\taboutGet():\t\t', this.name);

        // if we didn't have about data saved or if the about data is outdated...
        if (this.about.link_karma == undefined || datenow() - this.about.updated > cacheTime) {
            let domain = window.location.hostname;
            let url = 'https://' + domain + '/user/' + this.name + '/about.json';
            let results = await chrome.runtime.sendMessage({
                contentScriptQuery: "queryAbout",
                user: this
            });
			this.saveAbout(results.json);
        }
    };

    this.saveAbout = function(json) {
        consoleLog('\t\taboutSave():\t\t', this.name);
        this.about.link_karma = json.data?.link_karma;
        this.about.comment_karma = json.data?.comment_karma;
        this.about.created = json.data?.created;
        this.about.updated = datenow();
    };




    this.getDb = function() {
        consoleLog('\tgetDb():', this.name);

        let transaction = db.transaction([table]);

        // transaction errors
        transaction.onerror = function(e) {
            consoleLog('user.dbGet transaction error:');
            consoleLog(e);
        };

        let os = transaction.objectStore(table);
        let req = os.get(this.name);

        // request errors
        req.onerror = function(e) {
            consoleLog('user.dbGet error: ' + table + '!');
        };

        req.onsuccess = () => {
            if (req.result && req.result.about.updated !== null) {
                this.about = req.result.about;
                this.stats = req.result.stats;
                this.comments = req.result.comments;
            } else {
                this.about.updated = 0;
                this.stats.comments.updated = 0;
            }
        };
    }


    this.saveDb = function() {
        // consoleLog('\tsaveDb():', this.name);
        var os = db.transaction([table], "readwrite").objectStore(table);

        var save = {
            name: this.name,
            about: this.about,
            comments: this.comments,
            stats: this.stats
        };

        var req = os.put(save);

        req.onerror = function(event) {
            consoleLog('user.dbSave error: ' + table + ' - ' + this.name + '!');
        };
    }

    this.getDb();
    this.getAbout();
    this.getComments();
}



function round(num) {
    return Math.round(num * 100) / 100;
}

function datenow() {
    return Math.round(Date.now() / 1000);
}
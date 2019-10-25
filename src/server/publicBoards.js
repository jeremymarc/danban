import {loadState} from "../app/middleware/ledgerUtils"; 
import {filterObject} from "../app/components/utils"

const publicBoards = ledgerConn => (req, res, next) => {

  const ledgerURL = process.env.USE_SANDBOX
    ? "http://localhost:7575/"
    : `https://api.projectdabl.com/data/${process.env.DABL_LEDGER}/`;

    Promise.resolve(ledgerConn.adminToken())
    .then(jwt => loadState(ledgerURL, jwt))
    .then(state => {
      req.initialState = { 
        ...req.initialState,
        boardsById: filterObject(state.boardsById, board => board.isPublic),
        listsById: filterObject(state.listsById, list => state.boardsById[list.boardId].isPublic),
        cardsById: filterObject(state.cardsById, card => state.boardsById[card.boardId].isPublic),
       };
       next();
    });
};

export default publicBoards;